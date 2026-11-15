/**
 * Client API untuk TETUKO (Teknologi Terpadu Komprehensif).
 *
 * Semua panggilan frontend TIDAK pernah menyentuh host pusat secara
 * langsung — semuanya lewat /api/rpc (proxy lokal) atau route yang sama
 * di dev server. Tujuannya:
 *   1. Menutupi CORS di sisi browser.
 *   2. Menyembunyikan host pusat + identitas perangkat (TechMark) dari client.
 *   3. Menormalkan envelope JSON-RPC.
 */

import { apiUrl } from '../lib/apiBase';

import {
  type BaseRpcParam,
  type RpcRequestBody,
  type RpcResponse,
  type RpcObject,
  bolehUlang,
} from '../lib/presensiContract';
import { profileHeaders } from '../lib/activeProfile';
import { installGlobalFetchInstrumentation } from '../lib/devTraffic';

export { type ApiTrafficEntry, subscribeToApiTraffic } from '../lib/devTraffic';

// Pastikan seluruh fetch (API, /ep, web presensi, proxy, dsb.) tercatat di Developer Inspector.
installGlobalFetchInstrumentation();

function toErrorMessage(value: unknown, fallback = 'Terjadi kesalahan.'): string {
  if (value == null) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Error) return toErrorMessage((value as any).message, fallback);
  if (typeof value === 'object') {
    const v: any = value;
    const msg = v.message ?? v.error ?? v.msg ?? v.detail ?? v.keterangan ?? v.reason;
    if (typeof msg === 'string' && msg.trim()) return msg;
    if (msg && typeof msg === 'object') return toErrorMessage(msg, fallback);
    try { return JSON.stringify(value); } catch { return fallback; }
  }
  return fallback;
}

export class RpcError extends Error {
  readonly code?: number;

  constructor(message: unknown, code?: number) {
    super(toErrorMessage(message, 'Permintaan RPC gagal.'));
    this.name = 'RpcError';
    this.code = code;
  }
}

/*
 * ⚠️ Hanya `503` dari proxy kita sendiri yang layak diulang, yaitu "server
 * pusat sedang tidak melayani". `502` berarti proxy gagal meneruskan dan
 * penyebabnya biasanya permanen (URL salah, CORS, konfigurasi rusak) —
 * mengulangnya hanya menambah beban tanpa ada peluang untuk berhasil.
 */

/**
 * Berapa lama menunggu sebelum mengulang permintaan yang gagal.
 *
 * 900 ms dipilih karena dua-duanya harus benar: cukup lama untuk gateway
 * pusat yang sedang galat sesaat selesai, dan cukup pendek sehingga pengguna
 * tidak sempat menekan "Muat Ulang" duluan lalu memunculkan dua permintaan
 * untuk data yang sama.
 */
const TUNDA_ULANG_MS = 900;

/** Tunggu sebentar, atau batalkan lebih dulu kalau pemanggil sudah menyerah. */
function tungguUlangan(signal: AbortSignal | undefined, ms: number): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve();
    const id = setTimeout(done, ms);
    function done() {
      clearTimeout(id);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/**
 * Kirim satu panggilan JSON-RPC ke gateway pusat lewat proxy.
 *
 * ## Percobaan ulang untuk objek yang hanya membaca
 *
 * Proxy membalas `503` kalau server pusat mengembalikan `5xx` atau badan
 * kosong — keadaan yang terverifikasi terjadi sesaat di sisi server pusat
 * (`getlokasiabsen` sesekali membalas `HTTP 500` dengan badan nol byte).
 * Semula keadaan itu langsung tampil sebagai halaman galat, padahal
 * permintaan yang identik berhasil beberapa detik kemudian.
 *
 * Sekarang `503` dicoba **satu kali** lagi — dan hanya untuk objek yang
 * tercatat aman di `RPC_BISA_ULANG`. Objek yang mengubah data di server
 * (`absen`, `cekabsen`, `add_ijin`, …) tidak pernah diulang, supaya
 * kegagalan sesaat tidak berubah jadi catatan ganda.
 *
 * @param object nama RPC, cth. 'getworkcode', 'cekabsen', 'add_ijin'
 * @param param  payload; api_key / last_latlong / imei disuntik di server
 * @param options signal untuk membatalkan permintaan (mis. saat pindah halaman)
 */
export const rpc = async <T = any>(
  object: RpcObject | string,
  param: BaseRpcParam = {},
  options: { signal?: AbortSignal } = {}
): Promise<T | null> => {
  for (let percobaan = 0; ; percobaan++) {
    try {
      return await kirimRpc<T>(object, param, options);
    } catch (err: any) {
      const boleh = percobaan === 0 && bolehUlang(object) && err?.huluStatus === 503;
      if (!boleh) throw err;
      await tungguUlangan(options.signal, TUNDA_ULANG_MS);
      if (options.signal?.aborted) throw err;
    }
  }
};

/** Satu percobaan, tanpa pengulangan. Lihat `rpc()` untuk alasannya. */
const kirimRpc = async <T = any>(
  object: RpcObject | string,
  param: BaseRpcParam = {},
  options: { signal?: AbortSignal } = {}
): Promise<T | null> => {
  const url = apiUrl('/api/rpc');
  const body: RpcRequestBody = { object, param };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...profileHeaders(),
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (fetchErr: any) {
    const message = `Koneksi gagal: ${fetchErr?.message ?? 'tidak diketahui'}`;
    throw new Error(message);
  }

  const responseText = await response.text();

  if (!response.ok) {
    let errorMessage: string | null = null;
    try {
      const errJson = JSON.parse(responseText);
      if (errJson && (errJson.error || errJson.message)) {
        errorMessage = errJson.error || errJson.message;
      }
    } catch {
      // abaikan, pakai pesan generik
    }
    const message = errorMessage || `HTTP Error ${response.status}: ${responseText.slice(0, 200)}`;
    /*
     * Status hulu ikut dibawa ke error supaya `rpc()` bisa membedakan
     * "server pusat sedang galat sesaat" ( layak diulang ) dari galat lain.
     * Hanya diisi di jalur galat HTTP — di jalur 200 tidak pernah ada.
     */
    let huluStatus = 0;
    try {
      const bad = JSON.parse(responseText);
      if (typeof bad?.huluStatus === 'number') huluStatus = bad.huluStatus;
    } catch {
      // abaikan: bentuk galat tidak dikenal, dianggap tidak layak diulang
    }
    const err = new Error(message) as Error & { huluStatus: number };
    err.huluStatus = huluStatus;
    throw err;
  }

  let parsed: RpcResponse<T> & { error?: string; errorCode?: number; message?: string };
  try {
    parsed = JSON.parse(responseText);
  } catch {
    const isHtml =
      responseText.trim().startsWith('<!doctype') ||
      responseText.trim().startsWith('<html') ||
      responseText.trim().startsWith('<!DOCTYPE');
    const message = isHtml
      ? 'Gagal memuat data dari server pusat (menerima halaman HTML). Silakan segarkan halaman dan coba lagi.'
      : `Gagal membaca respons server (format tidak valid): ${responseText.slice(0, 200)}`;
    throw new Error(message);
  }

  // Proxy sudah meratakan: bentuk { jsonrpc, id_req, result } atau { error, errorCode }.
  if (parsed.error) {
    throw new RpcError(parsed.error, parsed.errorCode);
  }

  // Kegagalan bisnis = result null, bukan exception.
  return (parsed.result ?? null) as T | null;
};

/**
 * Teruskan satu request `multipart/form-data` ke proxy `/api/upload`.
 *
 * ⚠️ Endpoint ini hanya untuk `POST /importfile` — lampiran pengajuan
 * izin. Semua fungsi lain lewat `rpc()` (JSON-RPC ke `/api/rpc`).
 * Bentuk field-nya disalin apa adanya dari
 * `PerizinanFragment$uploadImage$multipartRequest$1` (APK v89):
 * `api_key`, `id`, `last_latlong` (kosong), `type` = "ijin", dan part
 * berkas bernama `image`.
 *
 * Proxy meneruskan body apa adanya (tanpa decode), jadi boundary tetap
 * milik browser dan nama field/filename tidak berubah di tengah jalan.
 *
 * @param parts nama field → nilai; `File` dikirim sebagai bagian berkas
 *              dengan nama field yang sama seperti di aplikasi.
 */
export const uploadMultipart = async <T = any>(
  path: string,
  parts: Record<string, string | File>
): Promise<T | null> => {
  const url = apiUrl(`/api/upload?path=${encodeURIComponent(path)}`);

  const form = new FormData();
  Object.entries(parts).forEach(([name, value]) => {
    form.append(name, value);
  });

  // ⚠️ Jangan set Content-Type: browser yang menambahkan boundary.
  const response = await fetch(url, { method: 'POST', body: form, headers: { ...profileHeaders() } });

  const responseText = await response.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error(`Respons unggah tidak valid (${responseText.slice(0, 200)})`);
  }

  if (!response.ok || parsed.error) {
    // Proxy meratakan `error` gateway jadi objek { message, code }, jadi
    // pesannya harus diambil dari sana — bukan di-string-ify-mentah.
    const message =
      parsed.error && typeof parsed.error === 'object'
        ? `Gateway menolak unggahan: ${parsed.error.message ?? 'tidak diketahui'}`
        : parsed.error || parsed.message || `HTTP ${response.status}`;
    throw new RpcError(message, parsed.errorCode);
  }

  return (parsed.result ?? null) as T | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Ponorogo/proxy client (unified in same API module)
// ─────────────────────────────────────────────────────────────────────────────

export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);
};

async function postPonorogo(path: string, body: any): Promise<any> {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok && data == null) throw new Error(`HTTP ${res.status}`);
  return data;
}

/**
 * Kirim request POST ke server presensi Ponorogo via proxy lokal Tauri.
 */
export const sendRequest = async (
  endpoint: string,
  payload: Record<string, any>,
  _options: { signal?: AbortSignal } = {}
): Promise<any> => {
  try {
    return await postPonorogo('/api/proxy', { endpoint, payload });
  } catch (err: any) {
    const message = typeof err === 'string' ? err : (err?.message || 'Koneksi gagal');
    throw new Error(message);
  }
};

/**
 * Kirim request multipart/form-data (misal pengajuan izin dengan lampiran file)
 */
export const sendMultipart = async (
  endpoint: string,
  fields: Record<string, string>,
  file?: { filename: string; base64: string; mimeType: string }
): Promise<any> => {
  return await postPonorogo('/api/proxy-multipart', { endpoint, fields, file });
};

/**
 * Fetch log presensi per instansi (Ponorogo).
 * Prioritas: endpoint proxy lokal /api/absensi-log-proxy (dev/tauri), fallback ke /ep/api/absensi-log/...
 */
export const fetchAbsensiLog = async (queryParams: URLSearchParams): Promise<any> => {
  const unor = queryParams.get('unor') || 'null';
  const start = queryParams.get('dateStart') || queryParams.get('start') || '';
  const end = queryParams.get('dateEnd') || queryParams.get('end') || '';
  const nama = queryParams.get('nama') || 'null';
  const nip = queryParams.get('nip') || 'null';
  const page = parseInt(queryParams.get('page') || '0', 10);
  const size = parseInt(queryParams.get('size') || '25', 10);

  const qp = new URLSearchParams();
  qp.set('unor', unor);
  qp.set('dateStart', start);
  qp.set('dateEnd', end);
  qp.set('nama', nama);
  qp.set('nip', nip);
  qp.set('page', String(page));
  qp.set('size', String(size));

  const readJsonSafe = async (res: Response) => {
    const text = await res.text();
    try { return text ? JSON.parse(text) : null; } catch { return { raw: text }; }
  };

  // 1) Local proxy route (dev-server / tauri)
  try {
    const res = await fetch(apiUrl(`/api/absensi-log-proxy?${qp.toString()}`), {
      headers: { 'Accept': 'application/json' },
    });
    const data = await readJsonSafe(res);
    if (res.ok && data && !data.error) return data;
    if (data && !data.error && (data.content || data.totalElements != null || Array.isArray(data))) return data;
  } catch {
    // fallback below
  }

  // 2) Fallback via EP proxy path
  const path = `/api/absensi-log/unor/${encodeURIComponent(unor)}/${encodeURIComponent(start)}/${encodeURIComponent(end)}/${encodeURIComponent(nama)}/${encodeURIComponent(nip)}?page.page=${page}&page.size=${size}&page=${page}&size=${size}`;
  const url = apiUrl(`/ep${path}`);
  const res = await fetch(url, { headers: { 'Accept': 'application/json', ...profileHeaders() } });
  const data = await readJsonSafe(res);
  if (!res.ok && data && !data.error) return { error: `HTTP ${res.status}`, ...(typeof data === 'object' ? data : {}) };
  return data;
};

/**
 * Download laporan PDF / XLS (best-effort via EP proxy)
 */
export const fetchReport = async (pathQuery: string): Promise<string> => {
  const params = new URLSearchParams(pathQuery);
  const reportType = params.get('reportType') || '';
  const idp = params.get('idp') || '';
  const idu = params.get('idu') || '';
  const t1 = params.get('t1') || '';
  const t2 = params.get('t2') || '';
  const status = params.get('status') || '';
  const format = params.get('format') || 'pdf';
  const fileExt = format === 'xls' ? 'xls' : 'pdf';

  let targetPath = '';
  if (reportType === 'per-pegawai') {
    targetPath = `/api/report/absensi/sby/per-pegawai.${fileExt}?idp=${encodeURIComponent(idp)}&t1=${encodeURIComponent(t1)}&t2=${encodeURIComponent(t2)}`;
  } else if (reportType === 'per-pegawai-aktivitas') {
    targetPath = `/api/report/absensi/prg/per-pegawai-aktivitas.${fileExt}?idp=${encodeURIComponent(idp)}&t1=${encodeURIComponent(t1)}&t2=${encodeURIComponent(t2)}`;
  } else if (reportType === 'rekap-instansi') {
    targetPath = `/api/report/absensi/sby/rekap-instansi.${fileExt}?idu=${encodeURIComponent(idu)}&t1=${encodeURIComponent(t1)}&t2=${encodeURIComponent(t2)}&status=${encodeURIComponent(status || 'all')}`;
  } else if (reportType === 'skor-per-instansi') {
    targetPath = `/api/report/absensi/sby/skor-per-instansi2026-new.${fileExt}?idu=${encodeURIComponent(idu)}&t1=${encodeURIComponent(t1)}&t2=${encodeURIComponent(t2)}&status=${encodeURIComponent(status || 'pns')}`;
  } else if (reportType === 'aktivitas-per-instansi') {
    targetPath = `/api/report/absensi/prg/aktivitas-per-instansi2026-new.${fileExt}?idu=${encodeURIComponent(idu)}&t1=${encodeURIComponent(t1)}&t2=${encodeURIComponent(t2)}&status=${encodeURIComponent(status || 'pns')}`;
  } else if (reportType === 'rekap-tpp-aktivitas') {
    targetPath = `/api/report/absensi/prg/rekap-tpp-aktivitas2026-new.${fileExt}?idu=${encodeURIComponent(idu)}&t1=${encodeURIComponent(t1)}&t2=${encodeURIComponent(t2)}&status=${encodeURIComponent(status || 'pns')}`;
  } else {
    throw new Error('reportType tidak valid atau tidak didukung');
  }

  // Fetch via EP proxy and return as data URL for download/open
  const res = await fetch(apiUrl(`/ep${targetPath}`), { headers: { 'Accept': '*/*', ...profileHeaders() } });
  if (!res.ok) throw new Error(`Gagal memuat laporan (${res.status})`);
  const ct = res.headers.get('content-type') || (fileExt === 'xls' ? 'application/vnd.ms-excel' : 'application/pdf');
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  return `data:${ct};base64,${b64}`;
};

