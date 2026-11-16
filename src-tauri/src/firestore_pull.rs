use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NativeFirestoreSyncConfig {
    /// Firebase project id (wajib untuk REST)
    pub project_id: String,
    /// Firebase Web API key (wajib untuk REST; akses tetap tunduk pada Security Rules)
    pub api_key: String,
    /// Kunci dekripsi payload terenkripsi (harus sama dengan VITE_PAYLOAD_KEY di aplikasi)
    pub payload_key: String,
    /// Aktifkan pull periodik dari Firestore REST ke state native lokal
    #[serde(default)]
    pub enabled: bool,
    /// Interval pull (detik), default 120
    #[serde(default = "default_interval")]
    pub interval_secs: u64,
}

fn default_interval() -> u64 {
    120
}

pub fn config_path(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join("native_firestore_sync.json")
}

pub fn load_config(app_data_dir: &PathBuf) -> Option<NativeFirestoreSyncConfig> {
    let path = config_path(app_data_dir);
    let text = std::fs::read_to_string(path).ok()?;
    let cfg = serde_json::from_str::<NativeFirestoreSyncConfig>(&text).ok()?;
    if cfg.project_id.trim().is_empty()
        || cfg.api_key.trim().is_empty()
        || cfg.payload_key.is_empty()
    {
        return None;
    }
    if !cfg.enabled {
        return None;
    }
    Some(cfg)
}

/// Dekripsi payload format ENC$...$SEC (kompatibel dengan lib/encryption.ts)
pub fn decrypt_payload(encrypted_str: &str, key: &str) -> Option<serde_json::Value> {
    if !(encrypted_str.starts_with("ENC$") && encrypted_str.ends_with("$SEC")) {
        return serde_json::from_str(encrypted_str).ok();
    }
    if encrypted_str.len() < 8 {
        return None;
    }
    let cleaned = &encrypted_str[4..encrypted_str.len() - 4];
    let layer2_rev: String = cleaned.chars().rev().collect();
    let binary = BASE64.decode(layer2_rev).ok()?;
    let layer1 = String::from_utf8(binary).ok()?;
    let key_chars: Vec<char> = key.chars().collect();
    if key_chars.is_empty() {
        return None;
    }
    let mut out = String::with_capacity(layer1.len());
    for (i, ch) in layer1.chars().enumerate() {
        let c = ch as u32;
        let k = key_chars[i % key_chars.len()] as u32;
        let unshifted = (c + 65536 - (k % 65536)) % 65536;
        if let Some(u) = char::from_u32(unshifted) {
            out.push(u);
        } else {
            return None;
        }
    }
    serde_json::from_str(&out).ok()
}

// Catatan: Implementasi HTTP pull periodik (Firestore REST documents/get atau runQuery)
// dapat ditambahkan di sini menggunakan reqwest + config eksplisit di atas.
// Untuk keamanan, kredensial tidak disematkan di binary; file config dikelola lokal oleh pengguna/admin.
