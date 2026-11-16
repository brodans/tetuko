use chrono::{Datelike, Duration, NaiveDate, NaiveTime, Timelike, Utc};
use rand::seq::SliceRandom;
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::RwLock;

const RPC_VERSION: u64 = 89;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AutomationStateFile {
    #[serde(default)]
    pub profiles: HashMap<String, ProfileAutomation>,
    #[serde(default)]
    pub runtime: RuntimeState,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RuntimeState {
    #[serde(default)]
    pub execution_log: HashMap<String, HashMap<String, ExecutionLogEntry>>, // key: profile::username::date -> preset_id -> entry
    #[serde(default)]
    pub photo_queues: HashMap<String, Vec<String>>, // key: profile::username::preset_id -> remaining shuffled ids
    #[serde(default)]
    pub random_times: HashMap<String, String>, // key: profile::username::preset_id::date -> HH:MM chosen
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExecutionLogEntry {
    pub preset_id: String,
    pub tanggal: String,
    pub berhasil: bool,
    pub pesan: Option<String>,
    pub eksekusi_pada: i64,
    pub lokasi_dipilih: Option<String>,
    pub foto_dipilih: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProfileAutomation {
    #[serde(default)]
    pub profile_id: String,
    #[serde(default)]
    pub mode: String, // bkd-rpc | ponorogo-absensi
    #[serde(default)]
    pub gateway_url: String,
    #[serde(default)]
    pub ep_base_url: String,
    #[serde(default)]
    pub ponorogo_api_base: String,
    #[serde(default)]
    pub scheduler_enabled: bool,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub bkd: Option<BkdContext>,
    #[serde(default)]
    pub ponorogo: Option<PonorogoContext>,
    #[serde(default)]
    pub unified_presets: Vec<UnifiedPreset>,
    #[serde(default)]
    pub legacy_ponorogo_presets: Vec<LegacyPonorogoPreset>,
    #[serde(default)]
    pub locations: Vec<LocationPoint>,
    #[serde(default)]
    pub stock_photos: Vec<StockPhoto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BkdContext {
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub imei: String,
    #[serde(default)]
    pub last_latlong: String,
    #[serde(default)]
    pub nip: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PonorogoContext {
    #[serde(default)]
    pub config: serde_json::Map<String, Value>,
    #[serde(default)]
    pub pegawai: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LocationPoint {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub nama: String,
    #[serde(default)]
    pub latitude: f64,
    #[serde(default)]
    pub longitude: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StockPhoto {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub nama: String,
    #[serde(default, rename = "dataUrl")]
    pub data_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UnifiedPreset {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub nama: String,
    #[serde(default, rename = "tipe")]
    pub tipe: String, // datang|pulang|custom
    #[serde(default, rename = "lokasiIds")]
    pub lokasi_ids: Vec<String>,
    #[serde(default, rename = "workcodeId")]
    pub workcode_id: String,
    #[serde(default, rename = "stockFotoIds")]
    pub stock_foto_ids: Vec<String>,
    #[serde(default, rename = "jamMulai")]
    pub jam_mulai: String,
    #[serde(default, rename = "jamSelesai")]
    pub jam_selesai: String,
    #[serde(default, rename = "hariAktif")]
    pub hari_aktif: Vec<i32>,
    #[serde(default)]
    pub aktif: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LegacyPonorogoPreset {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub nama: String,
    #[serde(default)]
    pub tipe: String, // masuk|pulang
    #[serde(default, rename = "jamMulai")]
    pub jam_mulai: String,
    #[serde(default, rename = "jamSelesai")]
    pub jam_selesai: String,
    #[serde(default, rename = "hariAktif")]
    pub hari_aktif: Vec<i32>,
    #[serde(default, rename = "stockFotoIds")]
    pub stock_foto_ids: Vec<String>,
    #[serde(default)]
    pub aktif: bool,
}

pub struct AutomationManager {
    pub state: RwLock<AutomationStateFile>,
    pub path: PathBuf,
    pub client: reqwest::Client,
}

impl AutomationManager {
    pub fn new(app: &AppHandle) -> Self {
        let dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| std::env::temp_dir().join("tetuko"));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("native_automation.json");
        let state = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<AutomationStateFile>(&s).ok())
            .unwrap_or_default();
        let client = reqwest::Client::builder()
            .cookie_store(true)
            .timeout(std::time::Duration::from_secs(45))
            .connect_timeout(std::time::Duration::from_secs(15))
            .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            state: RwLock::new(state),
            path,
            client,
        }
    }

    pub async fn save(&self) {
        let data = self.state.read().await.clone();
        if let Ok(s) = serde_json::to_string_pretty(&data) {
            let tmp = self.path.with_extension("json.tmp");
            if std::fs::write(&tmp, &s).is_ok() {
                let _ = std::fs::rename(&tmp, &self.path);
            } else {
                let _ = std::fs::write(&self.path, s);
            }
        }
    }

    pub async fn merge_sync(&self, incoming: AutomationStateFile) {
        let mut st = self.state.write().await;
        // Merge profiles (replace provided), keep runtime but allow provided runtime hints to merge
        for (k, v) in incoming.profiles {
            st.profiles.insert(k, v);
        }
        // merge runtime maps (incoming can carry known logs/queues if desired)
        for (k, v) in incoming.runtime.execution_log {
            st.runtime.execution_log.insert(k, v);
        }
        for (k, v) in incoming.runtime.photo_queues {
            st.runtime.photo_queues.insert(k, v);
        }
        for (k, v) in incoming.runtime.random_times {
            st.runtime.random_times.insert(k, v);
        }
        drop(st);
        self.save().await;
    }
}

pub fn wib_now() -> (NaiveDate, NaiveTime, i32) {
    let now = Utc::now() + Duration::hours(7);
    let date = now.date_naive();
    let time = now.time();
    let weekday = now.weekday().num_days_from_sunday() as i32; // 0=Sun..6=Sat
    (date, time, weekday)
}

fn parse_hhmm(s: &str) -> Option<NaiveTime> {
    let parts: Vec<&str> = s.trim().split(':').collect();
    if parts.len() != 2 {
        return None;
    }
    let h: u32 = parts[0].parse().ok()?;
    let m: u32 = parts[1].parse().ok()?;
    NaiveTime::from_hms_opt(h, m, 0)
}

fn in_range(start: NaiveTime, end: NaiveTime, now: NaiveTime) -> bool {
    if start <= end {
        now >= start && now <= end
    } else {
        now >= start || now <= end
    }
}

fn time_in_range_str(chosen: &str, start: &str, end: &str) -> bool {
    let Some(c) = parse_hhmm(chosen) else {
        return false;
    };
    let Some(s) = parse_hhmm(start) else {
        return false;
    };
    let Some(e) = parse_hhmm(end) else {
        return false;
    };
    in_range(s, e, c)
}

fn random_time_in_range(start: &str, end: &str) -> Option<String> {
    let s = parse_hhmm(start)?;
    let e = parse_hhmm(end)?;
    let sm = s.hour() * 60 + s.minute();
    let em = e.hour() * 60 + e.minute();
    let mut rng = rand::thread_rng();
    let pick = if sm <= em {
        rng.gen_range(sm..=em)
    } else {
        // crosses midnight: pick in [sm, 1439] union [0, em]
        let len1 = 1440 - sm;
        let len2 = em + 1;
        let total = len1 + len2;
        let r = rng.gen_range(0..total);
        if r < len1 {
            sm + r
        } else {
            r - len1
        }
    };
    Some(format!("{:02}:{:02}", pick / 60, pick % 60))
}

fn check_type_for(tipe: &str) -> i32 {
    match tipe {
        "datang" | "masuk" => 0,
        "pulang" => 3,
        "custom" | "siang" => 2,
        _ => 0,
    }
}

fn strip_data_url(data_url: &str) -> (String, String) {
    if let Some(idx) = data_url.find(",") {
        if data_url.starts_with("data:") {
            let meta = &data_url[5..idx];
            let mime = meta.split(';').next().unwrap_or("image/jpeg").to_string();
            return (data_url[idx + 1..].to_string(), mime);
        }
    }
    (data_url.to_string(), "image/jpeg".to_string())
}

fn get_str(map: &serde_json::Map<String, Value>, keys: &[&str]) -> String {
    for k in keys {
        if let Some(v) = map.get(*k) {
            match v {
                Value::String(s) => {
                    if !s.trim().is_empty() {
                        return s.clone();
                    }
                }
                Value::Number(n) => return n.to_string(),
                Value::Bool(b) => return b.to_string(),
                _ => {}
            }
        }
    }
    String::new()
}

fn get_str_or(map: &serde_json::Map<String, Value>, keys: &[&str], fallback: &str) -> String {
    let v = get_str(map, keys);
    if v.is_empty() {
        fallback.to_string()
    } else {
        v
    }
}

fn preset_checktype_label(tipe: &str) -> &'static str {
    match tipe {
        "pulang" => "Pulang",
        "custom" | "siang" => "Siang",
        _ => "Datang",
    }
}

async fn bkd_already_checked_in(
    mgr: &AutomationManager,
    profile: &ProfileAutomation,
    preset: &UnifiedPreset,
    tanggal: &str,
) -> bool {
    let Some(ctx) = profile.bkd.as_ref() else {
        return false;
    };
    let gateway = if !profile.gateway_url.is_empty() {
        profile.gateway_url.clone()
    } else {
        "https://presensi.bkd.jatimprov.go.id/service".to_string()
    };
    let param = json!({
        "tgl": tanggal,
        "page": 1,
        "limit": 50,
        "api_key": ctx.api_key,
        "last_latlong": ctx.last_latlong,
        "imei": ctx.imei,
    });
    let envelope = json!({
        "jsonrpc": 2,
        "method": "POST",
        "version": RPC_VERSION,
        "object": "history_absen",
        "param": param,
    });
    let resp = mgr
        .client
        .post(&gateway)
        .header("Content-Type", "application/json; charset=UTF-8")
        .header("Accept", "application/json")
        .header("User-Agent", "okhttp/4.12.0")
        .json(&envelope)
        .send()
        .await;
    let Ok(r) = resp else {
        return false;
    };
    if !r.status().is_success() {
        return false;
    }
    let Ok(text) = r.text().await else {
        return false;
    };
    let Ok(v) = serde_json::from_str::<Value>(&text) else {
        return false;
    };

    let target = preset_checktype_label(&preset.tipe).to_ascii_lowercase();
    let rows = if let Some(arr) = v.as_array() {
        Some(arr.clone())
    } else if let Some(arr) = v.get("result").and_then(|x| x.as_array()) {
        Some(arr.clone())
    } else if let Some(arr) = v.get("data").and_then(|x| x.as_array()) {
        Some(arr.clone())
    } else {
        None
    };

    if let Some(rows) = rows {
        for row in rows {
            let ct = row
                .get("checktype")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if ct.contains(&target) {
                return true;
            }
            // fallback umum: jika ada teks yang jelas mengindikasikan jenis sudah ada
            if target == "datang" && (ct.contains("masuk") || ct == "0") {
                return true;
            }
            if target == "pulang" && ct == "3" {
                return true;
            }
            if target == "siang" && (ct == "2" || ct.contains("custom")) {
                return true;
            }
        }
    }
    false
}

async fn send_notification(app: &AppHandle, title: &str, body: &str) {
    let payload = json!({"title": title, "body": body, "app": "TETUKO"});
    let _ = app.emit("tetuko://automation-notify", payload);
    // best effort native notification via plugin
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        use tauri_plugin_notification::NotificationExt;
        if let Err(e) = app.notification().builder().title(title).body(body).show() {
            eprintln!("[TETUKO] Gagal menampilkan notifikasi native: {}", e);
        }
    }
}

fn photo_for(
    manager: &mut AutomationStateFile,
    qkey: &str,
    ids: &[String],
    stock: &[StockPhoto],
) -> Option<(String, String)> {
    let valid: HashSet<String> = ids.iter().cloned().collect();
    let mut queue = manager
        .runtime
        .photo_queues
        .get(qkey)
        .cloned()
        .unwrap_or_default();
    queue.retain(|id| valid.contains(id));
    if queue.is_empty() && !ids.is_empty() {
        let mut shuffled = ids.to_vec();
        shuffled.shuffle(&mut rand::thread_rng());
        queue = shuffled;
    }
    if queue.is_empty() {
        return None;
    }
    let picked = queue.remove(0);
    manager.runtime.photo_queues.insert(qkey.to_string(), queue);
    let photo = stock.iter().find(|p| p.id == picked)?;
    Some((picked, photo.data_url.clone()))
}

async fn submit_bkd(
    app: &AppHandle,
    mgr: &AutomationManager,
    profile_key: &str,
    profile: &ProfileAutomation,
    preset: &UnifiedPreset,
    date: &NaiveDate,
    now_time: &NaiveTime,
) -> (bool, String, Option<String>) {
    let Some(ctx) = profile.bkd.as_ref() else {
        return (false, "Konteks BKD tidak tersedia".into(), None);
    };
    let username = profile.username.clone();
    let tanggal = date.format("%Y-%m-%d").to_string();
    let log_key = format!("{}::{}::{}", profile_key, username, tanggal);
    let rand_key = format!("{}::{}::{}::{}", profile_key, username, preset.id, tanggal);

    // choose random trigger time within window (reset jika di luar rentang preset saat ini, mis. preset diubah)
    {
        let mut need_save = false;
        {
            let mut st = mgr.state.write().await;
            let invalid = st
                .runtime
                .random_times
                .get(&rand_key)
                .map(|t| !time_in_range_str(t, &preset.jam_mulai, &preset.jam_selesai))
                .unwrap_or(false);
            if invalid {
                st.runtime.random_times.remove(&rand_key);
            }
            if !st.runtime.random_times.contains_key(&rand_key) {
                if let Some(t) = random_time_in_range(&preset.jam_mulai, &preset.jam_selesai) {
                    st.runtime.random_times.insert(rand_key.clone(), t);
                    need_save = true;
                }
            }
        }
        if need_save {
            mgr.save().await;
        }
    }
    let chosen = {
        mgr.state
            .read()
            .await
            .runtime
            .random_times
            .get(&rand_key)
            .cloned()
    };
    if let Some(ch) = chosen {
        if let Some(ct) = parse_hhmm(&ch) {
            // only execute at/after chosen minute
            let now_hm =
                NaiveTime::from_hms_opt(now_time.hour(), now_time.minute(), 0).unwrap_or(*now_time);
            if now_hm < ct {
                return (false, "__SKIP_NOT_YET__".into(), None);
            }
        }
    }

    // dedupe lokal
    {
        let st = mgr.state.read().await;
        if let Some(day) = st.runtime.execution_log.get(&log_key) {
            if let Some(e) = day.get(&preset.id) {
                if e.berhasil {
                    return (false, "__SKIP_DONE__".into(), e.lokasi_dipilih.clone());
                }
            }
        }
    }

    // Cek status absensi hari ini di server (hindari eksekusi ganda jika sudah absen manual/otomatis sebelumnya)
    if bkd_already_checked_in(mgr, profile, preset, &tanggal).await {
        let msg = format!(
            "Sudah ada absensi {} hari ini, dilewati.",
            preset_checktype_label(&preset.tipe)
        );
        {
            let mut st = mgr.state.write().await;
            let day = st.runtime.execution_log.entry(log_key.clone()).or_default();
            day.insert(
                preset.id.clone(),
                ExecutionLogEntry {
                    preset_id: preset.id.clone(),
                    tanggal: tanggal.clone(),
                    berhasil: true,
                    pesan: Some(msg.clone()),
                    eksekusi_pada: Utc::now().timestamp_millis(),
                    lokasi_dipilih: None,
                    foto_dipilih: None,
                },
            );
        }
        mgr.save().await;
        send_notification(
            app,
            "ℹ️ Presensi Otomatis Dilewati",
            &format!("{} — {}", preset.nama, msg),
        )
        .await;
        return (true, msg, None);
    }

    // location
    let mut lokasi_id = String::new();
    let mut last_latlong = ctx.last_latlong.clone();
    if !preset.lokasi_ids.is_empty() && !profile.locations.is_empty() {
        let valid: Vec<&LocationPoint> = profile
            .locations
            .iter()
            .filter(|l| preset.lokasi_ids.iter().any(|id| id == &l.id))
            .collect();
        if !valid.is_empty() {
            let pick = valid[rand::thread_rng().gen_range(0..valid.len())];
            lokasi_id = pick.id.clone();
            last_latlong = format!("{},{}", pick.latitude, pick.longitude);
        }
    }
    if preset.workcode_id.trim().is_empty() && profile.mode == "bkd-rpc" {
        let msg = "Workcode belum diatur untuk preset BKD.".to_string();
        let mut st = mgr.state.write().await;
        let day = st.runtime.execution_log.entry(log_key.clone()).or_default();
        day.insert(
            preset.id.clone(),
            ExecutionLogEntry {
                preset_id: preset.id.clone(),
                tanggal,
                berhasil: false,
                pesan: Some(msg.clone()),
                eksekusi_pada: Utc::now().timestamp_millis(),
                lokasi_dipilih: None,
                foto_dipilih: None,
            },
        );
        drop(st);
        mgr.save().await;
        send_notification(
            app,
            "⚠️ Presensi Otomatis Gagal",
            &format!("{} — {}", preset.nama, msg),
        )
        .await;
        return (false, msg, None);
    }

    let gateway = if !profile.gateway_url.is_empty() {
        profile.gateway_url.clone()
    } else {
        "https://presensi.bkd.jatimprov.go.id/service".into()
    };
    let param = json!({
        "checktype": check_type_for(&preset.tipe),
        "work_code": preset.workcode_id,
        "iswfh": 0,
        "ijin": 0,
        "keterangan": "",
        "type_ijin": 0,
        "mock": 0,
        "api_key": ctx.api_key,
        "last_latlong": last_latlong,
        "imei": ctx.imei,
    });
    let envelope = json!({
        "jsonrpc": 2,
        "method": "POST",
        "version": RPC_VERSION,
        "object": "absen",
        "param": param,
    });

    let resp = mgr
        .client
        .post(&gateway)
        .header("Content-Type", "application/json; charset=UTF-8")
        .header("Accept", "application/json")
        .header("User-Agent", "okhttp/4.12.0")
        .json(&envelope)
        .send()
        .await;

    let (ok, msg) = match resp {
        Ok(r) => {
            let status = r.status();
            let text = r.text().await.unwrap_or_default();
            let v: Value = serde_json::from_str(&text).unwrap_or(json!({"error": text}));
            if !status.is_success() {
                (
                    false,
                    v.get("error")
                        .and_then(|x| x.as_str())
                        .unwrap_or("Gagal presensi BKD")
                        .to_string(),
                )
            } else if v.get("absen").and_then(|x| x.as_bool()) == Some(false) {
                (
                    false,
                    v.get("message")
                        .and_then(|x| x.as_str())
                        .unwrap_or("Server menolak presensi")
                        .to_string(),
                )
            } else {
                (
                    true,
                    v.get("message")
                        .and_then(|x| x.as_str())
                        .unwrap_or("Presensi berhasil")
                        .to_string(),
                )
            }
        }
        Err(e) => (false, format!("Gagal menghubungi gateway: {}", e)),
    };

    // write log
    {
        let mut st = mgr.state.write().await;
        let day = st.runtime.execution_log.entry(log_key.clone()).or_default();
        day.insert(
            preset.id.clone(),
            ExecutionLogEntry {
                preset_id: preset.id.clone(),
                tanggal,
                berhasil: ok,
                pesan: Some(msg.clone()),
                eksekusi_pada: Utc::now().timestamp_millis(),
                lokasi_dipilih: if lokasi_id.is_empty() {
                    None
                } else {
                    Some(lokasi_id.clone())
                },
                foto_dipilih: None,
            },
        );
    }
    mgr.save().await;
    let title = if ok {
        "✅ Presensi Otomatis Berhasil"
    } else {
        "⚠️ Presensi Otomatis Gagal"
    };
    send_notification(app, title, &format!("{} — {}", preset.nama, msg)).await;
    let _ = app.emit(
        "tetuko://automation-executed",
        json!({
            "profile_id": profile_key.split("::").next().unwrap_or(profile_key),
            "profile_key": profile_key,
            "username": username,
            "preset_id": preset.id,
            "presetId": preset.id,
            "tanggal": date.format("%Y-%m-%d").to_string(),
            "ok": ok,
            "message": msg,
            "lokasi_dipilih": if lokasi_id.is_empty() { Value::Null } else { Value::String(lokasi_id.clone()) },
            "eksekusi_pada": Utc::now().timestamp_millis()
        }),
    );
    (
        ok,
        msg,
        if lokasi_id.is_empty() {
            None
        } else {
            Some(lokasi_id)
        },
    )
}

async fn submit_ponorogo_unified(
    app: &AppHandle,
    mgr: &AutomationManager,
    profile_key: &str,
    profile: &ProfileAutomation,
    preset: &UnifiedPreset,
    date: &NaiveDate,
    now_time: &NaiveTime,
) -> (bool, String) {
    let tanggal = date.format("%Y-%m-%d").to_string();
    let username = profile.username.clone();
    let log_key = format!("{}::{}::{}", profile_key, username, tanggal);
    let rand_key = format!("{}::{}::{}::{}", profile_key, username, preset.id, tanggal);
    {
        let mut need_save = false;
        {
            let mut st = mgr.state.write().await;
            let invalid = st
                .runtime
                .random_times
                .get(&rand_key)
                .map(|t| !time_in_range_str(t, &preset.jam_mulai, &preset.jam_selesai))
                .unwrap_or(false);
            if invalid {
                st.runtime.random_times.remove(&rand_key);
            }
            if !st.runtime.random_times.contains_key(&rand_key) {
                if let Some(t) = random_time_in_range(&preset.jam_mulai, &preset.jam_selesai) {
                    st.runtime.random_times.insert(rand_key.clone(), t);
                    need_save = true;
                }
            }
        }
        if need_save {
            mgr.save().await;
        }
    }
    let chosen = {
        mgr.state
            .read()
            .await
            .runtime
            .random_times
            .get(&rand_key)
            .cloned()
    };
    if let Some(ch) = chosen {
        if let Some(ct) = parse_hhmm(&ch) {
            let now_hm =
                NaiveTime::from_hms_opt(now_time.hour(), now_time.minute(), 0).unwrap_or(*now_time);
            if now_hm < ct {
                return (false, "__SKIP_NOT_YET__".into());
            }
        }
    }
    {
        let st = mgr.state.read().await;
        if let Some(day) = st.runtime.execution_log.get(&log_key) {
            if let Some(e) = day.get(&preset.id) {
                if e.berhasil {
                    return (false, "__SKIP_DONE__".into());
                }
            }
        }
    }

    let qkey = format!("{}::{}::{}", profile_key, username, preset.id);
    let (foto_id, foto_data) = {
        let mut st = mgr.state.write().await;
        match photo_for(
            &mut st,
            &qkey,
            &preset.stock_foto_ids,
            &profile.stock_photos,
        ) {
            Some(v) => v,
            None => {
                drop(st);
                return (false, "Foto preset tidak tersedia".into());
            }
        }
    };
    mgr.save().await;

    let Some(ctx) = profile.ponorogo.as_ref() else {
        return (false, "Konteks Ponorogo tidak tersedia".into());
    };
    let peg = &ctx.pegawai;
    let cfg = &ctx.config;
    let id_pegawai = get_str(peg, &["idPegawai", "id_pegawai", "id", "pegawai_id", "nip"]);
    let device_id = get_str(
        peg,
        &["imei", "deviceId", "device_id", "emei", "sim_serial"],
    );
    let nip = get_str(peg, &["nip"]);
    let nama = get_str(peg, &["nama"]);
    let (lampiran, _mime) = strip_data_url(&foto_data);
    let mut lat = get_str(cfg, &["latitude"]);
    if lat.is_empty() {
        lat = get_str(peg, &["latitude"]);
    }
    let mut lon = get_str(cfg, &["longitude"]);
    if lon.is_empty() {
        lon = get_str(peg, &["longitude"]);
    }
    let lat_s = lat;
    let lon_s = lon;
    let latlong = if !lat_s.is_empty() && !lon_s.is_empty() {
        format!("{},{}", lat_s, lon_s)
    } else {
        get_str(peg, &["last_latlong", "lastLatLong"])
    };

    let form: Vec<(String, String)> = vec![
        ("tanggal".into(), tanggal.clone()),
        (
            "keterangan".into(),
            if preset.tipe == "pulang" {
                "Presensi Pulang Otomatis"
            } else if preset.tipe == "custom" {
                "Presensi Siang Otomatis"
            } else {
                "Presensi Masuk Otomatis"
            }
            .into(),
        ),
        ("lampiran".into(), lampiran),
        ("sim_serial".into(), device_id.clone()),
        ("lattitude".into(), lat_s.clone()),
        ("latitude".into(), lat_s.clone()),
        ("longitude".into(), lon_s.clone()),
        ("latlong".into(), latlong),
        ("imei".into(), device_id.clone()),
        (
            "kode_instansi".into(),
            get_str_or(
                cfg,
                &["kodeInstansi", "kode_instansi"],
                &get_str(peg, &["kodeInstansi", "kode_instansi"]),
            ),
        ),
        (
            "kode_unor".into(),
            get_str_or(
                cfg,
                &["kodeUnor", "kode_unor"],
                &get_str(peg, &["kodeUnor", "kode_unor", "unor"]),
            ),
        ),
        (
            "id_lokasi".into(),
            get_str_or(
                cfg,
                &["idLokasi", "id_lokasi"],
                &get_str(peg, &["idLokasi", "id_lokasi"]),
            ),
        ),
        ("work_mode".into(), {
            let w = get_str(cfg, &["workMode", "work_mode"]);
            if w.is_empty() {
                "1".into()
            } else {
                w
            }
        }),
        ("id_pegawai".into(), id_pegawai.clone()),
        ("nip".into(), nip),
        ("nama".into(), nama),
        ("bedgenumber".into(), {
            let b = get_str(peg, &["badgenumber"]);
            if b.is_empty() {
                device_id.clone()
            } else {
                b
            }
        }),
        ("versi".into(), {
            let v = get_str(cfg, &["versi"]);
            if v.is_empty() {
                "1.0.0".into()
            } else {
                v
            }
        }),
        ("tipe".into(), preset.tipe.clone()),
    ];
    let _ = id_pegawai; // tersedia untuk kompatibilitas payload/logika upstream bila dibutuhkan
    if device_id.is_empty() && !cfg.get("imei").is_some() && !peg.get("imei").is_some() {
        // biarkan kosong; beberapa server menerima nilai kosong, validasi dilakukan upstream
    }

    let api_base = if !profile.ponorogo_api_base.is_empty() {
        profile.ponorogo_api_base.clone()
    } else {
        "http://103.109.206.102:8089/Ponorogo-absensApi/index.php".into()
    };
    let url = format!("{}/login/absen_mobile", api_base.trim_end_matches('/'));
    let resp = mgr
        .client
        .post(&url)
        .header("User-Agent", "Dart/3.0 (dart:io)")
        .header("Accept", "application/json, text/plain, */*")
        .header("Authorization", "Bearer null")
        .form(&form)
        .send()
        .await;

    let (ok, msg) = match resp {
        Ok(r) => {
            let status = r.status();
            let text = r.text().await.unwrap_or_default();
            let v: Value = serde_json::from_str(&text).unwrap_or(json!({"raw": text}));
            if !status.is_success() {
                (
                    false,
                    v.get("message")
                        .and_then(|x| x.as_str())
                        .unwrap_or("Gagal presensi Ponorogo")
                        .to_string(),
                )
            } else if v.get("success") == Some(&Value::Bool(true))
                || v.get("status") == Some(&Value::Bool(true))
                || v.get("status") == Some(&Value::String("success".into()))
                || v.get("code") == Some(&json!(200))
            {
                (
                    true,
                    v.get("message")
                        .and_then(|x| x.as_str())
                        .unwrap_or("Presensi berhasil")
                        .to_string(),
                )
            } else if v.get("success") == Some(&Value::Bool(false))
                || v.get("status") == Some(&Value::Bool(false))
            {
                let msg_text = v
                    .get("message")
                    .and_then(|x| x.as_str())
                    .unwrap_or("Server menolak presensi")
                    .to_string();
                let m = msg_text.to_lowercase();
                if m.contains("sudah absen")
                    || m.contains("sudah melakukan")
                    || m.contains("sudah presensi")
                    || m.contains("sudah hadir")
                {
                    (true, msg_text)
                } else {
                    (false, msg_text)
                }
            } else {
                let msg_text = v
                    .get("message")
                    .and_then(|x| x.as_str())
                    .unwrap_or("Respons server tidak dikenali")
                    .to_string();
                let m = msg_text.to_lowercase();
                if m.contains("berhasil")
                    || m.contains("sukses")
                    || m.contains("sudah absen")
                    || m.contains("sudah melakukan")
                    || m.contains("sudah presensi")
                {
                    (true, msg_text)
                } else {
                    (false, msg_text)
                }
            }
        }
        Err(e) => (false, format!("Gagal menghubungi server Ponorogo: {}", e)),
    };

    let tanggal_for_event = date.format("%Y-%m-%d").to_string();
    {
        let mut st = mgr.state.write().await;
        let day = st.runtime.execution_log.entry(log_key).or_default();
        day.insert(
            preset.id.clone(),
            ExecutionLogEntry {
                preset_id: preset.id.clone(),
                tanggal: tanggal.clone(),
                berhasil: ok,
                pesan: Some(msg.clone()),
                eksekusi_pada: Utc::now().timestamp_millis(),
                lokasi_dipilih: None,
                foto_dipilih: Some(foto_id.clone()),
            },
        );
    }
    mgr.save().await;
    let title = if ok {
        "✅ Presensi Otomatis Berhasil"
    } else {
        "⚠️ Presensi Otomatis Gagal"
    };
    send_notification(app, title, &format!("{} — {}", preset.nama, msg)).await;
    let _ = app.emit(
        "tetuko://automation-executed",
        json!({
            "profile_id": profile_key.split("::").next().unwrap_or(profile_key),
            "profile_key": profile_key,
            "username": profile.username,
            "preset_id": preset.id,
            "presetId": preset.id,
            "tanggal": tanggal_for_event,
            "ok": ok,
            "message": msg,
            "foto_dipilih": foto_id,
            "eksekusi_pada": Utc::now().timestamp_millis()
        }),
    );
    (ok, msg)
}

async fn submit_ponorogo_legacy(
    app: &AppHandle,
    mgr: &AutomationManager,
    profile_key: &str,
    profile: &ProfileAutomation,
    preset: &LegacyPonorogoPreset,
    date: &NaiveDate,
    now_time: &NaiveTime,
) -> (bool, String) {
    // map legacy preset to unified-like execution
    let mapped = UnifiedPreset {
        id: preset.id.clone(),
        nama: preset.nama.clone(),
        tipe: if preset.tipe == "pulang" {
            "pulang".into()
        } else {
            "datang".into()
        },
        lokasi_ids: vec![],
        workcode_id: String::new(),
        stock_foto_ids: preset.stock_foto_ids.clone(),
        jam_mulai: preset.jam_mulai.clone(),
        jam_selesai: preset.jam_selesai.clone(),
        hari_aktif: preset.hari_aktif.clone(),
        aktif: preset.aktif,
    };
    submit_ponorogo_unified(app, mgr, profile_key, profile, &mapped, date, now_time).await
}

pub async fn tick(app: &AppHandle, mgr: &Arc<AutomationManager>) {
    let (date, time, weekday) = wib_now();
    let profiles: Vec<(String, ProfileAutomation)> = {
        let st = mgr.state.read().await;
        st.profiles
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    };
    for (pkey, profile) in profiles {
        if !profile.scheduler_enabled {
            continue;
        }
        // unified presets (bkd or ponorogo-unified)
        for preset in &profile.unified_presets {
            if !preset.aktif {
                continue;
            }
            if !preset.hari_aktif.contains(&weekday) {
                continue;
            }
            let (Some(s), Some(e)) = (
                parse_hhmm(&preset.jam_mulai),
                parse_hhmm(&preset.jam_selesai),
            ) else {
                continue;
            };
            if !in_range(s, e, time) {
                continue;
            }
            if profile.mode == "ponorogo-absensi" {
                let _ =
                    submit_ponorogo_unified(app, mgr, &pkey, &profile, preset, &date, &time).await;
            } else {
                let _ = submit_bkd(app, mgr, &pkey, &profile, preset, &date, &time).await;
            }
        }
        // legacy ponorogo presets (separate storage model)
        for preset in &profile.legacy_ponorogo_presets {
            if !preset.aktif {
                continue;
            }
            if !preset.hari_aktif.contains(&weekday) {
                continue;
            }
            let (Some(s), Some(e)) = (
                parse_hhmm(&preset.jam_mulai),
                parse_hhmm(&preset.jam_selesai),
            ) else {
                continue;
            };
            if !in_range(s, e, time) {
                continue;
            }
            let _ = submit_ponorogo_legacy(app, mgr, &pkey, &profile, preset, &date, &time).await;
        }
    }
}

pub fn start_background(app: AppHandle, mgr: Arc<AutomationManager>) {
    tauri::async_runtime::spawn(async move {
        // beri waktu app & frontend melakukan sinkronisasi awal
        tokio::time::sleep(std::time::Duration::from_secs(4)).await;
        loop {
            tick(&app, &mgr).await;
            // interval cek 30 detik (responsif, stabil untuk eksekusi dalam jendela waktu preset)
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        }
    });
}

// Tauri commands

#[tauri::command]
pub async fn automation_sync(
    state: tauri::State<'_, Arc<AutomationManager>>,
    payload: AutomationStateFile,
) -> Result<bool, String> {
    state.merge_sync(payload).await;
    Ok(true)
}

#[tauri::command]
pub async fn automation_get_state(
    state: tauri::State<'_, Arc<AutomationManager>>,
) -> Result<AutomationStateFile, String> {
    Ok(state.state.read().await.clone())
}

#[tauri::command]
pub async fn automation_set_scheduler(
    state: tauri::State<'_, Arc<AutomationManager>>,
    profile_id: String,
    enabled: bool,
) -> Result<bool, String> {
    {
        let mut st = state.state.write().await;
        let mut touched = false;
        // exact key
        if let Some(p) = st.profiles.get_mut(&profile_id) {
            p.scheduler_enabled = enabled;
            touched = true;
        }
        // also apply to composite keys (profileId::username) for multi-account
        let prefix = format!("{}::", profile_id);
        for (k, p) in st.profiles.iter_mut() {
            if k.starts_with(&prefix) {
                p.scheduler_enabled = enabled;
                touched = true;
            }
        }
        if !touched {
            st.profiles.insert(
                profile_id.clone(),
                ProfileAutomation {
                    profile_id: profile_id.clone(),
                    scheduler_enabled: enabled,
                    ..Default::default()
                },
            );
        }
    }
    state.save().await;
    Ok(true)
}
