use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView};
use serde::Serialize;
use std::io::Cursor;
use std::sync::OnceLock;
use tract_onnx::prelude::*;

const PANJANG_CAPTCHA: usize = 4;

#[derive(Serialize, Clone, Debug)]
pub struct OcrResult {
    pub ok: bool,
    pub text: String,
    pub kandidat: Vec<String>,
    pub yakin: bool,
    pub panjang: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

type OcrPlan = SimplePlan<TypedFact, Box<dyn TypedOp>, Graph<TypedFact, Box<dyn TypedOp>>>;

struct OcrEngine {
    model: OcrPlan,
    charset: Vec<String>,
    digit_allowed: Vec<usize>, // indices allowed for digit-restricted decode (digits + blank 0)
}

static ENGINE: OnceLock<Result<OcrEngine, String>> = OnceLock::new();

fn get_engine() -> Result<&'static OcrEngine, String> {
    match ENGINE.get_or_init(init_engine) {
        Ok(e) => Ok(e),
        Err(e) => Err(e.clone()),
    }
}

fn init_engine() -> Result<OcrEngine, String> {
    let model_bytes = include_bytes!("../ocr_model.onnx");
    let charset_bytes = include_bytes!("../ocr_charset.json");

    let charset: Vec<String> = serde_json::from_slice(charset_bytes)
        .map_err(|e| format!("Gagal memuat charset OCR: {e}"))?;

    let mut digit_only: Vec<usize> = Vec::new();
    for (i, c) in charset.iter().enumerate() {
        if i != 0 && c.len() == 1 {
            let ch = c.as_bytes()[0];
            if ch.is_ascii_digit() {
                digit_only.push(i);
            }
        }
    }
    let mut digit_allowed = digit_only;
    if !digit_allowed.contains(&0) {
        digit_allowed.push(0);
    }

    let mut cursor = Cursor::new(model_bytes.as_ref());
    let model = tract_onnx::onnx()
        .model_for_read(&mut cursor)
        .map_err(|e| format!("Gagal membaca model ONNX: {e}"))?
        .into_optimized()
        .map_err(|e| format!("Gagal optimasi model OCR: {e}"))?
        .into_runnable()
        .map_err(|e| format!("Gagal menyiapkan model OCR: {e}"))?;

    Ok(OcrEngine {
        model,
        charset,
        digit_allowed,
    })
}

pub fn solve_captcha(bytes: &[u8]) -> OcrResult {
    match solve_captcha_inner(bytes) {
        Ok(r) => r,
        Err(e) => OcrResult {
            ok: false,
            text: String::new(),
            kandidat: vec![],
            yakin: false,
            panjang: PANJANG_CAPTCHA,
            engine: Some("onnx-rust-builtin".into()),
            error: Some(e),
        },
    }
}

fn solve_captcha_inner(bytes: &[u8]) -> Result<OcrResult, String> {
    let engine = get_engine()?;
    let img =
        image::load_from_memory(bytes).map_err(|e| format!("Gambar captcha tidak valid: {e}"))?;
    let (h, w, data) = preprocess(&img);
    let tensor: Tensor = tract_ndarray::Array4::from_shape_vec((1usize, 1usize, h, w), data)
        .map_err(|e| format!("Tensor OCR gagal: {e}"))?
        .into();

    let result = engine
        .model
        .run(tvec!(tensor.into()))
        .map_err(|e| format!("Inferensi OCR gagal: {e}"))?;
    let out = result
        .get(0)
        .ok_or_else(|| "Output OCR kosong".to_string())?
        .to_array_view::<f32>()
        .map_err(|e| format!("Output OCR tidak valid: {e}"))?;

    let shape = out.shape().to_vec();
    let (seq, classes) = if shape.len() == 3 {
        (shape[1], shape[2])
    } else if shape.len() == 2 {
        (shape[0], shape[1])
    } else {
        return Err(format!("Dimensi output OCR tidak didukung: {:?}", shape));
    };

    let flat: Vec<f32> = out.iter().copied().collect();

    let idx_digit = argmax_per_timestep(&flat, seq, classes, Some(&engine.digit_allowed));
    let teks_digit = ctc_decode(&idx_digit, &engine.charset);
    let idx_bebas = argmax_per_timestep(&flat, seq, classes, None);
    let teks_bebas = ctc_decode(&idx_bebas, &engine.charset);

    let mut kandidat: Vec<String> = Vec::new();
    for t in [teks_digit, teks_bebas] {
        if !t.is_empty() && !kandidat.contains(&t) {
            kandidat.push(t);
        }
    }

    let utama = kandidat
        .iter()
        .find(|k| k.len() == PANJANG_CAPTCHA && k.chars().all(|c| c.is_ascii_digit()))
        .cloned()
        .or_else(|| {
            kandidat
                .iter()
                .find(|k| k.len() == PANJANG_CAPTCHA)
                .cloned()
        })
        .or_else(|| kandidat.first().cloned())
        .unwrap_or_default();

    let yakin = utama.len() == PANJANG_CAPTCHA && utama.chars().all(|c| c.is_ascii_digit());

    Ok(OcrResult {
        ok: true,
        text: utama,
        kandidat,
        yakin,
        panjang: PANJANG_CAPTCHA,
        engine: Some("onnx-rust-builtin".into()),
        error: None,
    })
}

// returns (h, w, data NCHW flattened for 1x1xHxW)
fn preprocess(img: &DynamicImage) -> (usize, usize, Vec<f32>) {
    let (ow, oh) = img.dimensions();
    let target_h: u32 = 64;
    let oh = oh.max(1);
    let target_w: u32 = ((ow as f32) * (target_h as f32 / oh as f32))
        .round()
        .max(1.0) as u32;
    let resized = img.resize_exact(target_w, target_h, FilterType::Triangle);
    let gray = resized.to_luma8();
    let (w, h) = gray.dimensions();
    let mut data = Vec::with_capacity((w * h) as usize);
    for p in gray.pixels() {
        data.push(p[0] as f32 / 255.0);
    }
    (h as usize, w as usize, data)
}

fn argmax_per_timestep(
    logits: &[f32],
    seq: usize,
    classes: usize,
    allowed: Option<&[usize]>,
) -> Vec<usize> {
    let mut out = Vec::with_capacity(seq);
    for t in 0..seq {
        let base = t * classes;
        let mut best_i: usize = 0;
        let mut best_v: f32 = f32::NEG_INFINITY;
        if let Some(allow) = allowed {
            for &i in allow {
                if i < classes {
                    let v = logits[base + i];
                    if v > best_v {
                        best_v = v;
                        best_i = i;
                    }
                }
            }
        } else {
            for i in 0..classes {
                let v = logits[base + i];
                if v > best_v {
                    best_v = v;
                    best_i = i;
                }
            }
        }
        out.push(best_i);
    }
    out
}

fn ctc_decode(indices: &[usize], charset: &[String]) -> String {
    let mut out = String::new();
    let mut prev: isize = -1;
    for &i in indices {
        let ii = i as isize;
        if ii != prev && i != 0 {
            if let Some(c) = charset.get(i) {
                out.push_str(c);
            }
        }
        prev = ii;
    }
    out
}

pub fn engine_ready() -> bool {
    get_engine().is_ok()
}
