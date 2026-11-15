use axum::{
    extract::{Query, Request, State},
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode},
    response::IntoResponse,
    routing::{any, get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{net::SocketAddr, sync::Arc};
use tauri::Manager;
mod automation;
use tower_http::cors::{AllowHeaders, AllowMethods, AllowOrigin, CorsLayer};

const PRESENSI_VERSION: u64 = 89;
const LOCAL_PORT: u16 = 14200;

fn default_gateway_url() -> String {
    std::env::var("PRESENSI_DEFAULT_GATEWAY_URL")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "https://presensi.bkd.jatimprov.go.id/service".to_string())
}
fn default_ep_base_url() -> String {
    std::env::var("PRESENSI_DEFAULT_EP_BASE_URL")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "https://presensi.bkd.jatimprov.go.id".to_string())
}
fn allowed_hosts() -> Vec<String> {
    let raw = std::env::var("PRESENSI_ALLOWED_HOSTS").unwrap_or_default();
    let mut hosts: Vec<String> = raw
        .split(',')
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .collect();
    if hosts.is_empty() {
        hosts = vec![
            "presensi.bkd.jatimprov.go.id".into(),
            "absen.madiunkab.go.id".into(),
            "presensimadiun.appdev.web.id".into(),
            "presensi.ponorogo.go.id".into(),
            "103.109.206.102".into(),
        ];
    }
    hosts
}
fn host_of(url: &str) -> Option<String> {
    reqwest::Url::parse(url).ok().and_then(|u| u.host_str().map(|h| h.to_ascii_lowercase()))
}
fn allowed_target(url: &str, allow_ep: bool) -> bool {
    let Some(host) = host_of(url) else { return false; };
    let ok = allowed_hosts().iter().any(|h| h == &host);
    if !ok { return false; }
    if allow_ep { return true; }
    url.contains("/service") || url.contains("absensApi") || url.ends_with("/service")
}

fn resolve_gateway(headers: &HeaderMap, param: &Value) -> String {
    if let Some(v) = headers.get("x-presensi-gateway") {
        if let Ok(s) = v.to_str() {
            if allowed_target(s, false) { return s.to_string(); }
        }
    }
    if let Some(s) = param.get("gateway_url").and_then(|v| v.as_str()) {
        if allowed_target(s, false) { return s.to_string(); }
    }
    default_gateway_url()
}

fn resolve_ep_base(headers: &HeaderMap, uri: &axum::http::Uri) -> String {
    if let Some(v) = headers.get("x-presensi-ep-base") {
        if let Ok(s) = v.to_str() {
            if allowed_target(s, true) { return s.trim_end_matches('/').to_string(); }
        }
    }
    if let Some(q) = uri.query() {
        for pair in q.split('&') {
            let mut it = pair.splitn(2, '=');
            let k = it.next().unwrap_or("");
            let v = it.next().unwrap_or("");
            if k == "ep_base" {
                let decoded = urlencoding::decode(v).map(|s| s.into_owned()).unwrap_or_else(|_| v.to_string());
                if allowed_target(&decoded, true) { return decoded.trim_end_matches('/').to_string(); }
            }
        }
    }
    default_ep_base_url()
}

#[derive(Clone)]
struct AppState {
    client: reqwest::Client,
}

#[derive(Deserialize)]
struct RpcIn {
    object: String,
    #[serde(default)]
    param: Value,
}

#[derive(Serialize)]
struct RpcEnvelope {
    jsonrpc: u8,
    method: &'static str,
    version: u64,
    object: String,
    param: Value,
}

async fn rpc_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<RpcIn>,
) -> impl IntoResponse {
    let mut param = match input.param {
        Value::Object(m) => Value::Object(m),
        _ => json!({}),
    };
    let gateway = resolve_gateway(&headers, &param);
    if let Value::Object(ref mut m) = param {
        m.remove("gateway_url");
        m.entry("api_key").or_insert(Value::String(String::new()));
        m.entry("last_latlong").or_insert(Value::String(String::new()));
        m.entry("imei").or_insert(Value::String(String::new()));
    }

    let envelope = RpcEnvelope {
        jsonrpc: 2,
        method: "POST",
        version: PRESENSI_VERSION,
        object: input.object,
        param,
    };

    let upstream = state
        .client
        .post(&gateway)
        .header("Content-Type", "application/json; charset=UTF-8")
        .header("Accept", "application/json")
        .header("User-Agent", "okhttp/4.12.0")
        .json(&envelope)
        .send()
        .await;

    let resp = match upstream {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error": format!("Gagal menghubungi gateway: {}", e), "errorCode": 502, "huluStatus": 502})),
            )
                .into_response();
        }
    };

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        // Coba parse JSON error, jika tidak bungkus
        let body: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({"error": text}));
        let hulu = status.as_u16();
        let mut obj = body.as_object().cloned().unwrap_or_default();
        obj.entry("huluStatus").or_insert(json!(hulu));
        return (StatusCode::from_u16(hulu).unwrap_or(StatusCode::BAD_GATEWAY), Json(Value::Object(obj))).into_response();
    }

    match serde_json::from_str::<Value>(&text) {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err(_) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": "Respons gateway bukan JSON", "huluStatus": 502})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct UploadQuery {
    path: Option<String>,
}

async fn upload_handler(
    State(state): State<Arc<AppState>>,
    Query(q): Query<UploadQuery>,
    headers: HeaderMap,
    req: Request,
) -> impl IntoResponse {
    let uri = req.uri().clone();
    let method = req.method().clone();
    let path = q.path.unwrap_or_else(|| "/importfile".to_string());
    let upstream_url = if path.starts_with("http") {
        if allowed_target(&path, true) { path } else { return (StatusCode::FORBIDDEN, Json(json!({"error":"Target upload tidak diizinkan"}))).into_response(); }
    } else if path.starts_with('/') {
        let base = resolve_ep_base(&headers, &uri);
        format!("{}{}", base, path)
    } else {
        let base = resolve_ep_base(&headers, &uri);
        format!("{}/{}", base, path)
    };

    let body_bytes = match axum::body::to_bytes(req.into_body(), usize::MAX).await {
        Ok(b) => b,
        Err(e) => return (StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))).into_response(),
    };

    let mut rb = state.client.request(
        reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap_or(reqwest::Method::POST),
        upstream_url,
    );
    if let Some(ct) = headers.get("content-type") {
        rb = rb.header("content-type", ct.as_bytes());
    }
    rb = rb.header("Accept", "application/json");

    let resp = match rb.body(body_bytes).send().await {
        Ok(r) => r,
        Err(e) => return (StatusCode::BAD_GATEWAY, Json(json!({"error": e.to_string()}))).into_response(),
    };
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    let v: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({"error": text}));
    (StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY), Json(v)).into_response()
}

fn is_hop_by_hop(name: &str) -> bool {
    matches!(
        name,
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailers"
            | "transfer-encoding"
            | "upgrade"
            | "host"
            | "content-length"
    )
}

fn rewrite_location(loc: &str, ep_base: &str) -> String {
    let base = ep_base.trim_end_matches('/');
    let mut out = if let Some(stripped) = loc.strip_prefix(base) {
        let path = if stripped.is_empty() { "/" } else { stripped };
        format!("/ep{}", path)
    } else if loc.starts_with("http://") || loc.starts_with("https://") {
        if let Ok(parsed) = reqwest::Url::parse(loc) {
            if let Some(host) = parsed.host_str() {
                if allowed_hosts().iter().any(|h| h == &host.to_ascii_lowercase()) {
                    let path = parsed.path();
                    let q = parsed.query().map(|x| format!("?{}", x)).unwrap_or_default();
                    let p = if path.is_empty() { "/" } else { path };
                    format!("/ep{}{}", p, q)
                } else {
                    loc.to_string()
                }
            } else {
                loc.to_string()
            }
        } else {
            loc.to_string()
        }
    } else if loc.starts_with('/') {
        format!("/ep{}", loc)
    } else {
        loc.to_string()
    };
    if out.starts_with("/ep") {
        out = out.replace("/index.php/", "/p/").replace("/index.php", "/p");
    }
    out
}

async fn ep_proxy(State(state): State<Arc<AppState>>, req: Request) -> impl IntoResponse {
    let headers_in = req.headers().clone();
    let uri = req.uri().clone();
    let method = req.method().clone();
    let ep_base = resolve_ep_base(&headers_in, &uri);

    let path_and_query = uri
        .path_and_query()
        .map(|x| x.as_str().to_string())
        .unwrap_or_else(|| "/ep/".to_string());

    let upstream_path = path_and_query
        .strip_prefix("/ep")
        .unwrap_or(&path_and_query)
        .to_string();
    let mut upstream_path = if upstream_path.is_empty() {
        "/".to_string()
    } else {
        upstream_path
    };
    // Normalisasi path: klien memakai /p/... sebagai path aman, upstream memakai /index.php/...
    if upstream_path.starts_with("/p/") || upstream_path == "/p" {
        upstream_path = upstream_path.replacen("/p", "/index.php", 1);
    }
    let upstream_url = format!("{}{}", ep_base, upstream_path);

    let body_bytes = axum::body::to_bytes(req.into_body(), usize::MAX)
        .await
        .unwrap_or_default();

    let method_req = reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap_or(reqwest::Method::GET);
    let mut rb = state.client.request(method_req, &upstream_url);

    for (name, value) in headers_in.iter() {
        let n = name.as_str().to_ascii_lowercase();
        if is_hop_by_hop(&n) || matches!(n.as_str(), "origin" | "referer" | "x-presensi-ep-base" | "x-presensi-gateway") {
            continue;
        }
        if let (Ok(hn), Ok(hv)) = (
            reqwest::header::HeaderName::from_bytes(name.as_ref()),
            reqwest::header::HeaderValue::from_bytes(value.as_bytes()),
        ) {
            rb = rb.header(hn, hv);
        }
    }

    rb = rb.header("Origin", &ep_base);
    rb = rb.header("Referer", format!("{}/", ep_base));

    if !body_bytes.is_empty() {
        rb = rb.body(body_bytes);
    }

    let resp = match rb.send().await {
        Ok(r) => r,
        Err(e) => return (StatusCode::BAD_GATEWAY, format!("Proxy error: {}", e)).into_response(),
    };

    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let mut out_headers = HeaderMap::new();

    for (k, v) in resp.headers().iter() {
        let name_lc = k.as_str().to_ascii_lowercase();
        if is_hop_by_hop(&name_lc) {
            continue;
        }
        if name_lc == "set-cookie" {
            if let Ok(val_str) = v.to_str() {
                let mut filtered = val_str
                    .split(';')
                    .filter_map(|part| {
                        let t = part.trim();
                        let tl = t.to_ascii_lowercase();
                        if tl.starts_with("domain=") || tl.starts_with("path=") {
                            None
                        } else {
                            Some(t.to_string())
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("; ");
                if !filtered.is_empty() {
                    filtered.push_str("; Path=/ep");
                } else {
                    filtered = "Path=/ep".to_string();
                }
                if let Ok(hv) = HeaderValue::from_str(&filtered) {
                    out_headers.append(HeaderName::from_static("set-cookie"), hv);
                } else if let Ok(hv) = HeaderValue::from_bytes(v.as_bytes()) {
                    out_headers.append(HeaderName::from_static("set-cookie"), hv);
                }
            }
            continue;
        }
        if name_lc == "location" {
            if let Ok(val_str) = v.to_str() {
                let rewritten = rewrite_location(val_str, &ep_base);
                if let Ok(hv) = HeaderValue::from_str(&rewritten) {
                    out_headers.insert(HeaderName::from_static("location"), hv);
                }
            }
            continue;
        }
        if let (Ok(hn), Ok(hv)) = (
            HeaderName::from_bytes(k.as_ref()),
            HeaderValue::from_bytes(v.as_bytes()),
        ) {
            out_headers.insert(hn, hv);
        }
    }

    let bytes = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => return (StatusCode::BAD_GATEWAY, format!("Proxy read error: {}", e)).into_response(),
    };

    (status, out_headers, bytes).into_response()
}


// ═══════════════════════════════════════════════════════════════════════
//  Ponorogo (Ponorogo) proxy handlers
// ═══════════════════════════════════════════════════════════════════════

fn ponorogo_api_base() -> String {
    std::env::var("PRESENSI_PONOROGO_API_BASE")
        .or_else(|_| std::env::var("VITE_PONOROGO_API_BASE"))
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "http://103.109.206.102:8089/Ponorogo-absensApi/index.php".to_string())
}

#[derive(Deserialize)]
struct PonorogoProxyIn {
    endpoint: String,
    #[serde(default)]
    payload: serde_json::Map<String, Value>,
}

async fn ponorogo_proxy_handler(
    State(state): State<Arc<AppState>>,
    Json(input): Json<PonorogoProxyIn>,
) -> impl IntoResponse {
    let clean = if input.endpoint.starts_with('/') { input.endpoint } else { format!("/{}", input.endpoint) };
    let url = format!("{}{}", ponorogo_api_base(), clean);
    let mut form: Vec<(String, String)> = Vec::new();
    for (k, v) in input.payload {
        if v.is_null() { continue; }
        let sv = match v {
            Value::String(s) => s,
            other => other.to_string(),
        };
        form.push((k, sv));
    }
    let resp = state.client
        .post(&url)
        .header("User-Agent", "Dart/3.0 (dart:io)")
        .header("Accept", "application/json, text/plain, */*")
        .header("Authorization", "Bearer null")
        .form(&form)
        .send()
        .await;
    let resp = match resp { Ok(r)=>r, Err(e)=> return (StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Gagal menghubungi server Ponorogo: {}", e)}))).into_response() };
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let text = resp.text().await.unwrap_or_default();
    let v: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({"raw": text}));
    (status, Json(v)).into_response()
}

#[derive(Deserialize)]
struct PonorogoMultipartIn {
    endpoint: String,
    #[serde(default)]
    fields: serde_json::Map<String, Value>,
    file: Option<PonorogoFileIn>,
}
#[derive(Deserialize)]
struct PonorogoFileIn {
    filename: Option<String>,
    base64: String,
    #[serde(rename = "mimeType", alias = "mime_type")]
    mime_type: Option<String>,
}

async fn ponorogo_multipart_handler(
    State(state): State<Arc<AppState>>,
    Json(input): Json<PonorogoMultipartIn>,
) -> impl IntoResponse {
    let clean = if input.endpoint.starts_with('/') { input.endpoint } else { format!("/{}", input.endpoint) };
    let url = format!("{}{}", ponorogo_api_base(), clean);
    let mut form = reqwest::multipart::Form::new();
    for (k, v) in input.fields {
        if v.is_null() { continue; }
        let sv = match v { Value::String(s)=>s, other=>other.to_string() };
        form = form.text(k, sv);
    }
    if let Some(f) = input.file {
        if let Ok(bytes) = BASE64.decode(&f.base64) {
            let fname = f.filename.unwrap_or_else(|| "lampiran.jpg".to_string());
            let mime = f.mime_type.unwrap_or_else(|| "image/jpeg".to_string());
            match reqwest::multipart::Part::bytes(bytes).file_name(fname).mime_str(&mime) {
                Ok(part) => { form = form.part("lampiran", part); }
                Err(e) => return (StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))).into_response(),
            }
        }
    }
    let resp = state.client
        .post(&url)
        .header("User-Agent", "Dart/3.0 (dart:io)")
        .header("Accept", "application/json")
        .multipart(form)
        .send()
        .await;
    let resp = match resp { Ok(r)=>r, Err(e)=> return (StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Gagal kirim multipart: {}", e)}))).into_response() };
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let text = resp.text().await.unwrap_or_default();
    let v: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({"raw": text}));
    (status, Json(v)).into_response()
}


// (dihapus: proxy ke Node local API — aplikasi kini murni offline/proxy langsung ke server presensi)


#[derive(Deserialize)]
struct ProxyImageQuery {
    path: Option<String>,
    url: Option<String>,
    #[serde(rename = "use_base_url", alias = "useBaseUrl")]
    use_base_url: Option<String>,
}

async fn proxy_image_handler(
    State(state): State<Arc<AppState>>,
    Query(q): Query<ProxyImageQuery>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let mut raw = q.url.or(q.path).unwrap_or_default().trim().to_string();
    let use_base_url = q.use_base_url.as_deref().map(|v| v == "true" || v == "1").unwrap_or(false);
    if raw.is_empty() {
        return (StatusCode::BAD_REQUEST, "path/url diperlukan").into_response();
    }
    if raw.starts_with("data:") {
        return (StatusCode::BAD_REQUEST, "data URL tidak didukung").into_response();
    }
    // Normalisasi: beberapa pemanggil mengirim "/http(s)://..." sebagai path
    if raw.starts_with("/http://") || raw.starts_with("/https://") {
        raw = raw.trim_start_matches('/').to_string();
    }

    let ep_base = resolve_ep_base(&headers, &axum::http::Uri::from_static("/ep/"));
    let jatim_ep = default_ep_base_url();
    let madiun_ep = std::env::var("PRESENSI_MADIUN_EP_BASE_URL")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "https://presensimadiun.appdev.web.id".to_string());
    let ponorogo_img = "http://103.109.206.102:8087";
    let ponorogo_web = "https://presensi.ponorogo.go.id";

    let mut candidates: Vec<String> = Vec::new();

    if raw.starts_with("http://") || raw.starts_with("https://") {
        if !allowed_target(&raw, true) {
            return (StatusCode::FORBIDDEN, "Target gambar tidak diizinkan").into_response();
        }
        if let Ok(u) = reqwest::Url::parse(&raw) {
            let host = u.host_str().unwrap_or("").to_ascii_lowercase();
            let path = format!("{}{}", u.path(), u.query().map(|q| format!("?{}", q)).unwrap_or_default());
            if host == "103.109.206.102" && (u.port() == Some(8087) || u.port() == Some(8089) || u.port().is_none()) {
                candidates.push(format!("{}{}", ponorogo_img, path));
                candidates.push(format!("{}{}", ponorogo_web, path));
                candidates.push(raw.clone());
            } else if host == "presensi.ponorogo.go.id" {
                candidates.push(format!("{}{}", ponorogo_web, path));
                candidates.push(format!("{}{}", ponorogo_img, path));
                candidates.push(raw.clone());
            } else {
                candidates.push(raw.clone());
            }
        } else {
            candidates.push(raw.clone());
        }
    } else {
        let clean_path = if raw.starts_with('/') { raw.clone() } else { format!("/{}", raw) };
        if use_base_url {
            candidates.push(format!("{}{}", ponorogo_web, clean_path));
            candidates.push(format!("{}{}", ponorogo_img, clean_path));
        } else {
            candidates.push(format!("{}{}", ponorogo_img, clean_path));
            candidates.push(format!("{}{}", ponorogo_web, clean_path));
        }
        // Fallback EP base aktif (dari header/query) dan base profil umum (Jatim/Madiun/Ponorogo)
        for base in [
            ep_base.trim_end_matches('/').to_string(),
            jatim_ep.trim_end_matches('/').to_string(),
            madiun_ep.trim_end_matches('/').to_string(),
            ponorogo_web.to_string(),
        ] {
            if base.is_empty() { continue; }
            let u = format!("{}{}", base, clean_path);
            if !candidates.iter().any(|c| c == &u) {
                candidates.push(u);
            }
        }
    }

    let mut last_err: Option<String> = None;
    for url in candidates {
        match state
            .client
            .get(&url)
            .header("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
            .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .send()
            .await
        {
            Ok(resp) => {
                let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
                let mut out_headers = HeaderMap::new();
                let ct_str = resp
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("application/octet-stream")
                    .to_string();
                if let Ok(hv) = HeaderValue::from_str(&ct_str) {
                    out_headers.insert(axum::http::header::CONTENT_TYPE, hv);
                } else {
                    out_headers.insert(axum::http::header::CONTENT_TYPE, HeaderValue::from_static("application/octet-stream"));
                }
                out_headers.insert(axum::http::header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=3600"));
                match resp.bytes().await {
                    Ok(b) => {
                        if !status.is_success() || (ct_str.contains("text/html") && b.len() < 2048) {
                            last_err = Some(format!("bad response {} {}", status.as_u16(), ct_str));
                            continue;
                        }
                        return (status, out_headers, b).into_response();
                    }
                    Err(e) => { last_err = Some(format!("Gagal membaca gambar: {}", e)); }
                }
            }
            Err(e) => { last_err = Some(format!("Gagal memuat gambar: {}", e)); }
        }
    }
    (StatusCode::BAD_GATEWAY, last_err.unwrap_or_else(|| "Gagal memuat gambar".to_string())).into_response()
}

#[tauri::command]
async fn absensi_image_proxy(path: String, use_base_url: Option<bool>) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(false)
        .build()
        .map_err(|e| format!("client: {}", e))?;

    let raw = path.trim().to_string();
    if raw.is_empty() { return Err("path kosong".to_string()); }
    if raw.starts_with("data:") { return Err("data URL tidak didukung".to_string()); }

    let ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    let img_base = "http://103.109.206.102:8087";
    let web_base = "https://presensi.ponorogo.go.id";
    let jatim_ep = default_ep_base_url();
    let madiun_ep = std::env::var("PRESENSI_MADIUN_EP_BASE_URL").ok().filter(|v| !v.trim().is_empty()).unwrap_or_else(|| "https://presensimadiun.appdev.web.id".to_string());

    let mut candidates: Vec<String> = Vec::new();
    if raw.starts_with("http://") || raw.starts_with("https://") {
        if !allowed_target(&raw, true) {
            return Err("Target gambar tidak diizinkan".to_string());
        }
        candidates.push(raw.clone());
    } else {
        let clean = if raw.starts_with('/') { raw.clone() } else { format!("/{}", raw) };
        if use_base_url == Some(true) {
            candidates.push(format!("{}{}", web_base, clean));
            candidates.push(format!("{}{}", img_base, clean));
        } else {
            candidates.push(format!("{}{}", img_base, clean));
            candidates.push(format!("{}{}", web_base, clean));
        }
        // fallback untuk foto/path dari profil EP (Jatim/Madiun/Ponorogo)
        for base in [web_base.to_string(), jatim_ep, madiun_ep] {
            let u = format!("{}{}", base.trim_end_matches('/'), clean);
            if !candidates.contains(&u) { candidates.push(u); }
        }
    }

    let mut last_err: Option<String> = None;
    for url in candidates {
        let res = client
            .get(&url)
            .header(reqwest::header::USER_AGENT, ua)
            .header(reqwest::header::ACCEPT, "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
            .header(reqwest::header::REFERER, &url)
            .send()
            .await;
        let response = match res {
            Ok(r) => r,
            Err(e) => { last_err = Some(format!("Gagal memuat gambar: {}", e)); continue; }
        };
        if !response.status().is_success() {
            last_err = Some(format!("Status HTTP: {}", response.status()));
            continue;
        }
        let mime = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("image/jpeg")
            .to_string();
        let bytes = match response.bytes().await {
            Ok(b) => b,
            Err(e) => { last_err = Some(e.to_string()); continue; }
        };
        if mime.contains("text/html") && bytes.len() < 4096 {
            last_err = Some("Respon bukan gambar".to_string());
            continue;
        }
        let b64 = BASE64.encode(bytes);
        return Ok(format!("data:{};base64,{}", mime, b64));
    }

    Err(last_err.unwrap_or_else(|| "Gagal memuat gambar".to_string()))
}



#[derive(Deserialize)]
struct AbsensiLogQuery {
    unor: Option<String>,
    #[serde(rename = "dateStart", alias = "start")]
    date_start: Option<String>,
    #[serde(rename = "dateEnd", alias = "end")]
    date_end: Option<String>,
    nama: Option<String>,
    nip: Option<String>,
    page: Option<String>,
    size: Option<String>,
}

async fn absensi_log_proxy_handler(
    State(state): State<Arc<AppState>>,
    Query(q): Query<AbsensiLogQuery>,
) -> impl IntoResponse {
    let strip_danger = |v: &str| -> String {
        v.chars().filter(|c| c.is_ascii_alphanumeric() || *c == ' ' || *c == '.' || *c == '_' || *c == '-').collect::<String>().trim().to_string()
    };
    let unor_raw = q.unor.unwrap_or_default();
    let start = q.date_start.unwrap_or_default();
    let end = q.date_end.unwrap_or_default();
    let nama_raw = q.nama.unwrap_or_default();
    let nip_raw = q.nip.unwrap_or_default();
    let page = q.page.as_deref().and_then(|v| v.parse::<i64>().ok()).unwrap_or(1).max(1);
    let size = q.size.as_deref().and_then(|v| v.parse::<i64>().ok()).unwrap_or(25).clamp(1, 100);

    let unor_val = if unor_raw.trim().is_empty() || unor_raw.trim() == "null" { "null".to_string() } else { strip_danger(unor_raw.trim()) };
    let nama_val = if nama_raw.trim().is_empty() || nama_raw.trim() == "null" { "null".to_string() } else { urlencoding::encode(&strip_danger(nama_raw.trim())).into_owned() };
    let nip_val = if nip_raw.trim().is_empty() || nip_raw.trim() == "null" { "null".to_string() } else { urlencoding::encode(&strip_danger(nip_raw.trim())).into_owned() };

    if unor_val == "null" && nama_val == "null" && nip_val == "null" {
        return (StatusCode::BAD_REQUEST, Json(json!({"error":"Pilih instansi atau masukkan nama/NIP untuk melakukan pencarian."}))).into_response();
    }

    // Primary: direct IP + Host header (bypass Cloudflare/domain block, seperti j4dum4n)
    let ip_target = format!(
        "https://103.109.206.102/api/absensi-log/unor/{}/{}/{}/{}/{}?page.page={}&page.size={}&page={}&size={}",
        urlencoding::encode(&unor_val),
        urlencoding::encode(start.trim()),
        urlencoding::encode(end.trim()),
        nama_val,
        nip_val,
        page, size, page, size
    );
    let host_target = format!(
        "https://presensi.ponorogo.go.id/api/absensi-log/unor/{}/{}/{}/{}/{}?page.page={}&page.size={}&page={}&size={}",
        urlencoding::encode(&unor_val),
        urlencoding::encode(start.trim()),
        urlencoding::encode(end.trim()),
        nama_val,
        nip_val,
        page, size, page, size
    );

    let mut resp = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .ok()
        .map(|c| async move {
            c.get(&ip_target)
                .header("Accept", "application/json, text/plain, */*")
                .header("Accept-Language", "en-US,en;q=0.9,id;q=0.8")
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
                .header("Referer", "https://presensi.ponorogo.go.id/")
                .header("Origin", "https://presensi.ponorogo.go.id")
                .header("Host", "presensi.ponorogo.go.id")
                .header("Cache-Control", "no-cache")
                .send()
                .await
        });

    let resp = if let Some(fut) = resp.take() {
        match fut.await {
            Ok(r) => Ok(r),
            Err(_) => state.client
                .get(&host_target)
                .header("Accept", "application/json, text/plain, */*")
                .header("Accept-Language", "en-US,en;q=0.9,id;q=0.8")
                .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
                .header("Referer", "https://presensi.ponorogo.go.id/")
                .header("Origin", "https://presensi.ponorogo.go.id")
                .send()
                .await,
        }
    } else {
        state.client
            .get(&host_target)
            .header("Accept", "application/json, text/plain, */*")
            .header("Accept-Language", "en-US,en;q=0.9,id;q=0.8")
            .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .header("Referer", "https://presensi.ponorogo.go.id/")
            .header("Origin", "https://presensi.ponorogo.go.id")
            .send()
            .await
    };

    let resp = match resp { Ok(r)=>r, Err(e)=> return (StatusCode::BAD_GATEWAY, Json(json!({"error": format!("Gagal memuat log presensi instansi: {}", e)}))).into_response() };
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let text = resp.text().await.unwrap_or_default();
    let v: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({"raw": text}));
    (status, Json(v)).into_response()
}

async fn start_local_server() {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("reqwest client");

    let state = Arc::new(AppState { client });
    // Proxy lokal dipakai dari webview Tauri/dev dengan credentials (cookie sesi /ep).
    // Jangan gunakan wildcard origin/headers bersamaan dengan credentials (panic di tower-http 0.6.x).
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::mirror_request())
        .allow_methods(tower_http::cors::AllowMethods::mirror_request())
        .allow_headers(AllowHeaders::mirror_request())
        .allow_credentials(true);

    let app = Router::new()
        .route("/api/health", get(|| async { Json(json!({"ok": true, "app": "tetuko"})) }))
        .route("/api/rpc", post(rpc_handler))
        .route("/api/upload", any(upload_handler))
        .route("/api/proxy", post(ponorogo_proxy_handler))
        .route("/api/proxy-multipart", post(ponorogo_multipart_handler))
        .route("/api/proxy-image", get(proxy_image_handler))
        .route("/api/absensi-log-proxy", get(absensi_log_proxy_handler))
        .route("/api/ponorogo/proxy", post(ponorogo_proxy_handler))
        .route("/api/ponorogo/proxy-multipart", post(ponorogo_multipart_handler))
        .route("/ep", any(ep_proxy))
        .route("/ep/", any(ep_proxy))
        .route("/ep/{*rest}", any(ep_proxy))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], LOCAL_PORT));
    match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => {
            eprintln!("Server lokal TETUKO aktif di http://{}", addr);
            if let Err(e) = axum::serve(listener, app).await {
                eprintln!("Server lokal TETUKO berhenti: {}", e);
            }
        }
        Err(e) => {
            eprintln!("Gagal menjalankan server lokal TETUKO di {}: {}", addr, e);
            // Coba port alternatif (14201-14205) agar aplikasi tetap berfungsi jika 14200 terpakai
            for p in 14201u16..=14205u16 {
                let alt = SocketAddr::from(([127, 0, 0, 1], p));
                if let Ok(listener) = tokio::net::TcpListener::bind(alt).await {
                    eprintln!("Server lokal TETUKO berjalan di port alternatif http://{}", alt);
                    if let Err(err) = axum::serve(listener, app).await {
                        eprintln!("Server lokal TETUKO (alt) berhenti: {}", err);
                    }
                    return;
                }
            }
            eprintln!("Tidak ada port lokal (14200-14205) yang dapat digunakan untuk proxy TETUKO.");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            absensi_image_proxy,
            automation::automation_sync,
            automation::automation_get_state,
            automation::automation_set_scheduler
        ])
        .setup(|app| {
            let mgr = Arc::new(automation::AutomationManager::new(&app.handle()));
            app.manage(mgr.clone());
            automation::start_background(app.handle().clone(), mgr);
            tauri::async_runtime::spawn(async {
                start_local_server().await;
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running TETUKO");
}
