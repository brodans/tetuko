// @ts-nocheck
import charset from './ocrCharset.json';

type OcrResult = { teks: string; kandidat: string[]; yakin: boolean };

let sessionPromise: Promise<any> | null = null;
let ortMod: any = null;

const PANJANG = 4;

function getDigitAllowedIndices(): number[] {
  const idxs: number[] = [];
  for (let i = 0; i < (charset as string[]).length; i++) {
    const c = (charset as string[])[i];
    if (i !== 0 && c >= '0' && c <= '9') idxs.push(i);
  }
  return idxs;
}
const DIGIT_IDX = getDigitAllowedIndices();

async function loadSession() {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const ort = await import('onnxruntime-web/wasm');
    ortMod = ort;
    try {
      // Arahkan ke aset lokal yang dibundel (built-in, offline)
      (ort.env.wasm as any).wasmPaths = '/ort/';
      (ort.env.wasm as any).numThreads = 1;
      (ort.env.wasm as any).proxy = false;
    } catch {}
    const sess = await ort.InferenceSession.create('/ocr_model.onnx', {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    } as any);
    return sess;
  })().catch((e) => {
    sessionPromise = null;
    throw e;
  });
  return sessionPromise;
}

async function blobToImageData(blob: Blob): Promise<ImageData> {
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(blob);
    try {
      const h = 64;
      const w = Math.max(1, Math.round((bmp.width * h) / Math.max(1, bmp.height)));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas 2D tidak tersedia');
      // latar putih (untuk transparansi) lalu gambar
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bmp, 0, 0, w, h);
      return ctx.getImageData(0, 0, w, h);
    } finally {
      try { bmp.close(); } catch {}
    }
  }
  // fallback via Image element
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('Gagal memuat gambar captcha'));
      im.src = url;
    });
    const h = 64;
    const w = Math.max(1, Math.round((img.naturalWidth * h) / Math.max(1, img.naturalHeight || 1)));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D tidak tersedia');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function preprocessToTensor(imageData: ImageData, ort: any) {
  const { data, width: w, height: h } = imageData;
  const float = new Float32Array(1 * 1 * h * w);
  // grayscale + normalize [0,1], layout NCHW
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      // PIL L mode approximation
      const gray = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
      float[y * w + x] = gray;
    }
  }
  return new ort.Tensor('float32', float, [1, 1, h, w]);
}

function ctcDecode(indices: Int32Array | number[], cs: string[]): string {
  const out: string[] = [];
  let prev = -1;
  for (let t = 0; t < indices.length; t++) {
    const i = Number(indices[t]);
    if (i !== prev && i !== 0) {
      out.push(cs[i] ?? '');
    }
    prev = i;
  }
  return out.join('');
}

function argmaxPerTimestep(logits: Float32Array, seq: number, classes: number, allowed?: Set<number>): Int32Array {
  const res = new Int32Array(seq);
  for (let t = 0; t < seq; t++) {
    let bestI = 0;
    let bestV = -Infinity;
    const base = t * classes;
    if (allowed) {
      for (const i of allowed) {
        const v = logits[base + i];
        if (v > bestV) { bestV = v; bestI = i; }
      }
    } else {
      for (let i = 0; i < classes; i++) {
        const v = logits[base + i];
        if (v > bestV) { bestV = v; bestI = i; }
      }
    }
    res[t] = bestI;
  }
  return res;
}

export async function selesaikanCaptchaLokal(blob: Blob): Promise<OcrResult> {
  try {
    const sess = await loadSession();
    const ort = ortMod || (await import('onnxruntime-web/wasm'));
    const imageData = await blobToImageData(blob);
    const input = preprocessToTensor(imageData, ort);
    const feeds: Record<string, any> = {};
    const inName = sess.inputNames ? sess.inputNames[0] : 'input1';
    feeds[inName] = input;
    const results = await sess.run(feeds);
    const outName = sess.outputNames ? sess.outputNames[0] : Object.keys(results)[0];
    const out = results[outName];
    const data = out.data as Float32Array;
    const dims = out.dims as number[]; // expect [1, seq, classes] or [seq, classes]
    let seq = 0, classes = 0;
    if (dims.length === 3) {
      seq = dims[1];
      classes = dims[2];
    } else if (dims.length === 2) {
      seq = dims[0];
      classes = dims[1];
    } else {
      // fallback: assume charset length
      classes = (charset as string[]).length;
      seq = Math.floor(data.length / Math.max(1, classes));
    }

    const cs = charset as string[];
    const allowedDigit = new Set<number>([0, ...DIGIT_IDX]);
    const idxDigit = argmaxPerTimestep(data, seq, classes, allowedDigit);
    const teksDigit = ctcDecode(idxDigit, cs);
    const idxBebas = argmaxPerTimestep(data, seq, classes);
    const teksBebas = ctcDecode(idxBebas, cs);

    const kandidat: string[] = [];
    for (const t of [teksDigit, teksBebas]) {
      if (t && !kandidat.includes(t)) kandidat.push(t);
    }
    const utama =
      kandidat.find((k) => k.length === PANJANG && /^\d+$/.test(k)) ||
      kandidat.find((k) => k.length === PANJANG) ||
      kandidat[0] ||
      '';

    return {
      teks: utama,
      kandidat,
      yakin: /^\d+$/.test(utama) && utama.length === PANJANG,
    };
  } catch (e) {
    console.warn('[captchaOcr] lokal gagal:', e);
    return { teks: '', kandidat: [], yakin: false };
  }
}

export async function bisaOcrLokal(): Promise<boolean> {
  try {
    // cek cepat ketersediaan aset model (built-in)
    const r = await fetch('/ocr_model.onnx', { method: 'HEAD' });
    return r.ok;
  } catch {
    return false;
  }
}
