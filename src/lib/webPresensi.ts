/**
 * Modul komunikasi dengan Web e-Presensi via proxy `/ep/*`.
 * Adapted for unified app (profile-aware EP base via header/cookie handled by proxy).
 */

import { apiUrl, ensureTauriApiBase, getTauriApiBase, rebaseTauriApiUrlToCurrent } from './apiBase';

const PROXY = '/ep';
function epUrl(pathAfterEp: string) {
  // pathAfterEp starts with '/'
  return apiUrl(`${PROXY}${pathAfterEp}`);
}

let _epBaseOverride: string | null = null;
export function setWebPresensiEpBase(base: string | null | undefined) {
  _epBaseOverride = base && base.trim() ? base.trim() : null;
}

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as Record<string, unknown>;
  return Boolean(win.__TAURI__ || win.__TAURI_INTERNALS__ || win.__TAURI_METADATA__);
}

const PESAN_JARINGAN = isTauriRuntime()
  ? 'Tidak bisa menjangkau proxy lokal aplikasi (/ep). Pastikan aplikasi TETUKO berjalan normal, lalu coba muat ulang atau buka kembali aplikasi.'
  : 'Tidak bisa menjangkau server Web Presensi lewat proxy /ep. Pastikan aplikasi dijalankan dengan "npm run dev" atau "npm run tauri:dev".';

/** fetch dengan credentials include dan pesan error yang jelas. */
async function req(url: string, opts: RequestInit = {}): Promise<Response> {
  const doFetch = async (targetUrl: string) => {
    const headers = new Headers(opts.headers || {});
    if (_epBaseOverride && !_epBaseOverride.includes('undefined')) {
      headers.set('x-presensi-ep-base', _epBaseOverride);
    }
    return await fetch(targetUrl, { credentials: 'include', ...opts, headers });
  };

  let targetUrl = url;
  if (isTauriRuntime()) {
    await ensureTauriApiBase();
    targetUrl = rebaseTauriApiUrlToCurrent(url);
  }

  try {
    const res = await doFetch(targetUrl);
    // Proxy lokal dapat mengembalikan error terstruktur jika upstream diblokir Cloudflare challenge.
    if (res.status === 502 && res.headers.get('x-tetuko-ep-challenge') === '1') {
      try {
        const j = await res.clone().json();
        const msg = (j && (j.error || j.message)) ? String(j.error || j.message) : 'Upstream presensi diblokir Cloudflare challenge.';
        const err = new Error(msg);
        (err as any).epChallenge = true;
        (err as any).status = 502;
        throw err;
      } catch (e2) {
        if ((e2 as any)?.epChallenge) throw e2;
      }
    }
    return res;
  } catch (e) {
    if ((e as any)?.epChallenge) throw e;
    // Tauri: probe ulang port proxy lokal lalu retry sekali jika target masih lokal (127.0.0.1:14200-14205)
    if (isTauriRuntime()) {
      try {
        await ensureTauriApiBase(true);
        const rebased = rebaseTauriApiUrlToCurrent(url);
        return await doFetch(rebased);
      } catch {
        // abaikan, lanjut lempar error asli
      }
    }

    const detail = e instanceof Error ? e.message : String(e || 'unknown');
    const hint = isTauriRuntime()
      ? ` (proxy lokal ${getTauriApiBase()} tidak merespons — pastikan build TETUKO terbaru terinstal dan aplikasi berjalan normal)`
      : ' (pastikan server dev/proxy aktif)';
    const err = new Error(`${PESAN_JARINGAN}${hint} [${detail}]`);
    (err as Error & { sebab: unknown }).sebab = e;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Utilitas penguraian HTML
// ---------------------------------------------------------------------------

export function teks(html: string): string {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/[ \t\u00a0]+/g, ' ')
    .split('\n')
    .map((b) => b.trim())
    .filter((b) => b.length)
    .join('\n')
    .trim();
}

export function teksSatu(html: string): string {
  return teks(html).replace(/\s+/g, ' ').trim();
}

function selAdmin(baris: string, kelas: string): string {
  const re = new RegExp(`<td[^>]*sf_admin_list_td_${kelas}\\b[^>]*>([\\s\\S]*?)<\\/td>`, 'i');
  const m = baris.match(re);
  return m ? m[1] : '';
}

function bagian(html: string): string[] {
  return String(html)
    .split(/<br\s*\/?>|<hr\s*\/?>/i)
    .map((b) => teksSatu(b))
    .filter((b) => b.length);
}

function selMentah(baris: string): string[] {
  return baris.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || [];
}

export function hitungTotalHalaman(html: string): number {
  let maks = 1;
  const re = /[?&]page=(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > maks) maks = n;
  }
  return maks;
}

function isHalamanLogin(html: string): boolean {
  return html.includes('m_user[email]') && html.includes('m_user[CAPTCHA]');
}

type ApiError = Error & { sesiHabis?: boolean; perluCaptchaBaru?: boolean; jenis?: string };

function pesanLoginLebihJelas(pesan: string): string {
  const t = pesan.toLowerCase().replace(/\s+/g, ' ');
  const polaNip = /(?:email|e-?mail|nip|username|user|akun).{0,60}(?:salah|keliru|tidak valid|tidak cocok|tidak ditemukan|tidak terdaftar|invalid|incorrect|wrong|not found|not registered|does not exist)|(?:salah|keliru|tidak valid|tidak cocok|tidak ditemukan|tidak terdaftar|invalid|incorrect|wrong|not found|not registered|does not exist).{0,60}(?:email|e-?mail|nip|username|user|akun)/i;
  const polaPassword = /(?:password|kata sandi|sandi).{0,60}(?:salah|keliru|tidak valid|tidak cocok|tidak sesuai|invalid|incorrect|wrong)|(?:salah|keliru|tidak valid|tidak cocok|tidak sesuai|invalid|incorrect|wrong).{0,60}(?:password|kata sandi|sandi)/i;
  const polaCaptcha = /(?:captcha|capcha|kode verifikasi).{0,60}(?:salah|keliru|tidak valid|tidak cocok|invalid|incorrect|wrong)|(?:salah|keliru|tidak valid|tidak cocok|invalid|incorrect|wrong).{0,60}(?:captcha|capcha|kode verifikasi)/i;
  const kategori = [polaNip.test(t), polaPassword.test(t), polaCaptcha.test(t)];
  if (kategori.filter(Boolean).length !== 1) return pesan;
  if (kategori[0]) return 'Email / NIP tidak terdaftar.';
  if (kategori[1]) return 'Password salah.';
  return 'Captcha salah.';
}

function teksErrorLogin(html: string): string {
  const pesan: string[] = [];
  const elemenError = /<(?:div|span|p)\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*(?:alert-danger|help-block|invalid-feedback|text-danger|error)[^"']*\1)[^>]*>([\s\S]*?)<\/(?:div|span|p)>/gi;
  for (const cocok of html.matchAll(elemenError)) {
    const tx = cocok[2]
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;|&#34;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\s+/g, ' ')
      .trim();
    if (tx) pesan.push(tx);
  }
  return pesan.join(' ');
}

function pastikanBukanLogin(html: string): void {
  if (isHalamanLogin(html)) {
    const err = new Error('Sesi berakhir, silakan login ulang.') as ApiError;
    err.sesiHabis = true;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Captcha + login
// ---------------------------------------------------------------------------

export interface CaptchaResult { url: string; blob: Blob; }
export interface OcrResult { teks: string; kandidat: string[]; yakin: boolean; }

export async function muatCaptcha(): Promise<CaptchaResult> {
  // Coba beberapa variasi endpoint karena tiap server/portal (Jatim/Madiun/mirror)
  // bisa memakai path captcha berbeda.
  const kandidat: Array<{ init: string; captcha: string }> = [
    { init: epUrl('/p/'), captcha: epUrl(`/p/captcha?r=${Math.random()}&reload=1`) },
    { init: epUrl('/'), captcha: epUrl(`/captcha?r=${Math.random()}&reload=1`) },
    { init: epUrl('/index.php/p/'), captcha: epUrl(`/index.php/p/captcha?r=${Math.random()}&reload=1`) },
    { init: epUrl('/index.php/'), captcha: epUrl(`/index.php/captcha?r=${Math.random()}&reload=1`) },
    { init: epUrl('/p/'), captcha: epUrl(`/captcha?r=${Math.random()}&reload=1`) },
  ];

  let lastStatus = 0;
  let lastErr: unknown = null;

  for (const k of kandidat) {
    try {
      try { await req(k.init); } catch { /* init best-effort untuk set cookie/session */ }
      const res = await req(k.captcha);
      lastStatus = res.status;
      if (!res.ok) continue;
      const blob = await res.blob();
      const ct = (res.headers.get('content-type') || blob.type || '').toLowerCase();
      // Pastikan benar-benar gambar (bukan HTML error/login)
      if (blob.size < 32) continue;
      if (ct && !ct.includes('image') && !ct.includes('octet-stream')) {
        // coba tetap lanjut jika tampak seperti gambar kecil
        continue;
      }
      return { url: URL.createObjectURL(blob), blob };
    } catch (e) {
      lastErr = e;
    }
  }

  if (lastStatus) throw new Error(`Gagal memuat captcha (HTTP ${lastStatus})`);
  if (lastErr instanceof Error) throw new Error(`Gagal memuat captcha — ${lastErr.message}`);
  throw new Error('Gagal memuat captcha (tidak ada endpoint yang cocok).');
}

export async function selesaikanCaptcha(blob: Blob): Promise<OcrResult> {
  let res: Response;
  try {
    res = await fetch(apiUrl('/api/ocr'), {
      method: 'POST',
      body: blob,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  } catch {
    return { teks: '', kandidat: [], yakin: false };
  }
  const data = await res.json().catch(() => ({})) as { ok?: boolean; text?: string; kandidat?: string[]; yakin?: boolean; error?: string };
  if (!res.ok || !data.ok) {
    return { teks: '', kandidat: [], yakin: false };
  }
  return { teks: data.text || '', kandidat: data.kandidat || [], yakin: !!data.yakin };
}

export async function login({ nip, password, captcha }: { nip: string; password: string; captcha: string }): Promise<boolean> {
  const body = new URLSearchParams({
    'm_user[email]': nip.replace(/\s/g, ''),
    'm_user[password]': password.replace(/\s/g, ''),
    'm_user[CAPTCHA]': captcha.replace(/\s/g, ''),
  });
  const res = await req(epUrl('/p/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const html = await res.text();
  if (isHalamanLogin(html)) {
    const pesan = teksErrorLogin(html) || 'Login gagal (periksa NIP, password, dan captcha).';
    const err = new Error(pesanLoginLebihJelas(pesan)) as ApiError;
    err.perluCaptchaBaru = true;
    err.jenis = /captcha/i.test(pesan) ? 'captcha' : 'kredensial';
    throw err;
  }
  if (!res.ok) {
    let pesan = `Login gagal menghubungi server e-Presensi (HTTP ${res.status}).`;
    try {
      const data = JSON.parse(html) as { error?: unknown; detail?: unknown };
      if (typeof data.error === 'string') {
        pesan = data.error;
        if (typeof data.detail === 'string' && data.detail) pesan += `: ${data.detail}`;
      }
    } catch { /* ignore */ }
    throw new Error(pesan);
  }
  return true;
}

export async function logout(): Promise<void> {
  try { await fetch(epUrl('/p/default/logout'), { credentials: 'include' }); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Kehadiran
// ---------------------------------------------------------------------------

export interface BarisKehadiran {
  id: string | null; idMap: string | null; nama: string; nip: string; statusPegawai: string;
  lat: number | null; lng: number | null; alamatPresensi: string; unitKerja: string; alamatRumah: string;
  jarak: string; checktype: string; imei: string; disetujui: boolean | null; waktuApproval: string;
  created_at: string; timezone: string; wfh: string; workCode: string;
}
export interface ProfilPegawaiWeb { nama: string; nip: string; }
export interface HasilImei { imei: string | null; profil: ProfilPegawaiWeb | null; }
export interface HasilKehadiran { baris: BarisKehadiran[]; halaman: number; totalHalaman: number; }

export function extractImeis(html: string): string[] {
  const norm = html.replace(/\s+/g, ' ');
  const re = /sf_admin_list_td_imei">\s*([^<]+?)\s*<\//g;
  const hasil: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm))) {
    const v = m[1].trim();
    if (v && v !== '-') hasil.push(v);
  }
  return [...new Set(hasil)];
}

export function extractProfil(html: string): ProfilPegawaiWeb | null {
  const norm = html.replace(/\s+/g, ' ');
  const m = norm.match(/>\s*([^<>]{3,90}?)\s*<br>\s*(\d{8,20})\s*<br>/);
  if (m) return { nama: m[1].trim(), nip: m[2] };
  return null;
}

export function parseKehadiran(html: string): BarisKehadiran[] {
  const hasil: BarisKehadiran[] = [];
  const barisSemua = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const r of barisSemua) {
    if (!/sf_admin_list_td_imei/i.test(r)) continue;
    const selPegawai = bagian(selAdmin(r, 'pegawai_id'));
    const selLatlong = selAdmin(r, 'latlong');
    const koord = selLatlong.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
    const idMap = (selLatlong.match(/latlong=(\d+)/i) || [])[1] || null;
    const bagianLatlong = bagian(selLatlong);
    const alamatPresensi = bagianLatlong.slice(1).join(' ').replace(/^[-\d.,\s]+/, '').trim();
    const selDept = bagian(selAdmin(r, 'departemen'));
    const selApproval = selAdmin(r, 'approval');
    const bagianApproval = bagian(selApproval);
    const disetujui = /fa-check/i.test(selApproval) ? true : /fa-times/i.test(selApproval) ? false : null;
    hasil.push({
      id: (r.match(/name="ids\[\]"\s+value="(\d+)"/i) || [])[1] || idMap || null,
      idMap,
      nama: selPegawai[0] || '',
      nip: selPegawai[1] || '',
      statusPegawai: selPegawai[2] || '',
      lat: koord ? parseFloat(koord[1]) : null,
      lng: koord ? parseFloat(koord[2]) : null,
      alamatPresensi,
      unitKerja: selDept[0] || '',
      alamatRumah: selDept[1] || '',
      jarak: teksSatu(selAdmin(r, 'jarak')),
      checktype: teksSatu(selAdmin(r, 'checktype')),
      imei: teksSatu(selAdmin(r, 'imei')),
      disetujui,
      waktuApproval: bagianApproval.find((b) => /\d{4}/.test(b)) || '',
      created_at: teksSatu(selAdmin(r, 'created_at')),
      timezone: teksSatu(selAdmin(r, 'timezone')),
      wfh: teksSatu(selAdmin(r, 'iswfh')),
      workCode: teksSatu(selAdmin(r, 'work_code')),
    });
  }
  return hasil;
}

export async function ambilImei(): Promise<HasilImei> {
  const res = await req(epUrl('/p/checkinout'));
  if (!res.ok) throw new Error(`Gagal memuat kehadiran (HTTP ${res.status})`);
  const html = await res.text();
  pastikanBukanLogin(html);
  const profil = extractProfil(html);
  const imeis = extractImeis(html);
  return { imei: imeis[0] || null, profil };
}

export async function ambilKehadiran({ halaman = 1 }: { halaman?: number } = {}): Promise<HasilKehadiran> {
  const suffix = halaman > 1 ? `?page=${halaman}` : '';
  const url = epUrl(`/p/checkinout${suffix}`);
  const res = await req(url);
  if (!res.ok) throw new Error(`Gagal memuat kehadiran (HTTP ${res.status})`);
  const html = await res.text();
  pastikanBukanLogin(html);
  return { baris: parseKehadiran(html), halaman, totalHalaman: hitungTotalHalaman(html) };
}

export interface KoordinatPresisi { lat: number | null; lng: number | null; }

export function parseLatlong(html: string): KoordinatPresisi {
  const lat = (html.match(/Latitude\s*:\s*(-?\d+(?:\.\d+)?)/i) || [])[1];
  const lng = (html.match(/Longitude\s*:\s*(-?\d+(?:\.\d+)?)/i) || [])[1];
  return { lat: lat ? parseFloat(lat) : null, lng: lng ? parseFloat(lng) : null };
}

export async function ambilLatlong(idMap: string): Promise<KoordinatPresisi> {
  const res = await req(epUrl(`/p/checkinout/load/action?latlong=${encodeURIComponent(idMap)}`));
  if (!res.ok) throw new Error(`Gagal memuat lokasi (HTTP ${res.status})`);
  return parseLatlong(await res.text());
}

// ---------------------------------------------------------------------------
// Detail pegawai (tersedia untuk profil Jatim; profil lain menyesuaikan tab)
// ---------------------------------------------------------------------------

export interface TabelData { header: string[]; baris: string[][]; }
export interface DetailPegawai {
  profil: Record<string, string>; foto: string | null; idPegawai: string | null; urlIjin: string | null;
  logLogin: TabelData | null; fotoUpload: TabelData | null;
}

export function tabelDenganHeader(html: string, pola: RegExp): TabelData | null {
  const tabelSemua = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  for (const t of tabelSemua) {
    const header = (t.match(/<th[^>]*>[\s\S]*?<\/th>/gi) || []).map((x) => teksSatu(x));
    if (!header.some((h) => pola.test(h))) continue;
    const baris = (t.match(/<tr[\s\S]*?<\/tr>/gi) || [])
      .filter((r) => /<td/i.test(r))
      .map((r) => selMentah(r).map((c) => teksSatu(c)));
    return { header, baris };
  }
  return null;
}

export function parseDetailPegawai(html: string): DetailPegawai {
  const profil: Record<string, string> = {};
  const reProfil = /<td[^>]*>\s*([^<>]{1,40}?)\s*<\/td>\s*<td[^>]*>\s*:\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  let mp: RegExpExecArray | null;
  while ((mp = reProfil.exec(html))) {
    const label = teksSatu(mp[1]);
    if (label) profil[label] = teksSatu(mp[2]);
  }
  const foto = (html.match(/<img[^>]*width="150px"[^>]*src="([^"]+)"/i) || [])[1] || null;
  const idPegawai = (html.match(/\/(?:index\.php\/)?pegawai\/(\d+)\/ijins/i) || [])[1] || null;
  const urlIjin = idPegawai ? `/p/pegawai/${idPegawai}/ijins` : null;
  return {
    profil, foto, idPegawai, urlIjin,
    logLogin: tabelDenganHeader(html, /^imei$/i),
    fotoUpload: tabelDenganHeader(html, /tanggal upload/i),
  };
}

export async function ambilDetailPegawai(): Promise<DetailPegawai> {
  const res = await req(epUrl('/p/pegawai/details/action'));
  if (!res.ok) throw new Error(`Gagal memuat detail pegawai (HTTP ${res.status})`);
  const html = await res.text();
  pastikanBukanLogin(html);
  return parseDetailPegawai(html);
}

// ---------------------------------------------------------------------------
// Perizinan + berkas
// ---------------------------------------------------------------------------

export interface BarisIjin {
  id: string | null; nama: string; nip: string; unitKerja: string; tipeIjin: string; jenisIjin: string;
  tglIjin: string; alasan: string; catatan: string; berkas: string | null; disetujui: boolean | null;
  approvalAt: string; createdAt: string;
}
export interface HasilPerizinan { baris: BarisIjin[]; halaman: number; totalHalaman: number; }

function ambilBerkasDari(html: string): string | null {
  const m = String(html).match(/(?:href|src)="([^"]*uploads\/[^"]+)"/i);
  return m ? m[1] : null;
}
function statusApproval(html: string): boolean | null {
  if (/fa-check/i.test(html)) return true;
  if (/fa-times/i.test(html)) return false;
  return null;
}

export function parsePerizinan(html: string): BarisIjin[] {
  const hasil: BarisIjin[] = [];
  const barisSemua = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const r of barisSemua) {
    if (!/sf_admin_list_td_/i.test(r)) continue;
    const selPegawai = bagian(selAdmin(r, 'pegawai_id'));
    const selUnit = bagian(selAdmin(r, 'departemen'));
    const selTgl = bagian(selAdmin(r, 'tgl_ijin'));
    const selApproval = selAdmin(r, 'approval');
    const bagianApproval = bagian(selApproval);
    hasil.push({
      id: (r.match(/name="ids\[\]"\s+value="(\d+)"/i) || [])[1] || null,
      nama: selPegawai[0] || '',
      nip: selPegawai[1] || '',
      unitKerja: selUnit[0] || selUnit.join(' ') || '',
      tipeIjin: teksSatu(selAdmin(r, 'jenis_ijin_id')),
      jenisIjin: teksSatu(selAdmin(r, 'pegawai_id_master_tipe_ijin')),
      tglIjin: selTgl[0] || teksSatu(selAdmin(r, 'tgl_ijin')),
      alasan: teksSatu(selAdmin(r, 'keterangan')),
      catatan: teksSatu(selAdmin(r, 'approval_note')),
      berkas: ambilBerkasDari(selAdmin(r, 'attachment')) || ambilBerkasDari(r),
      disetujui: statusApproval(selApproval),
      approvalAt: bagianApproval.find((b) => /\d{4}/.test(b)) || '',
      createdAt: teksSatu(selAdmin(r, 'created_at')),
    });
  }
  return hasil;
}

export async function ambilPerizinan({ halaman = 1 }: { halaman?: number } = {}): Promise<HasilPerizinan> {
  const suffix = halaman > 1 ? `?page=${halaman}` : '';
  const res = await req(epUrl(`/p/perizinan${suffix}`));
  if (!res.ok) throw new Error(`Gagal memuat perizinan (HTTP ${res.status})`);
  const html = await res.text();
  pastikanBukanLogin(html);
  return { baris: parsePerizinan(html), halaman, totalHalaman: hitungTotalHalaman(html) };
}

export async function ambilIjinPegawai(idPegawai: string, { halaman = 1 }: { halaman?: number } = {}): Promise<HasilPerizinan> {
  const suffix = halaman > 1 ? `?page=${halaman}` : '';
  const res = await req(epUrl(`/p/pegawai/${encodeURIComponent(idPegawai)}/ijins${suffix}`));
  if (!res.ok) throw new Error(`Gagal memuat perizinan pegawai (HTTP ${res.status})`);
  const html = await res.text();
  pastikanBukanLogin(html);
  return { baris: parsePerizinan(html), halaman, totalHalaman: hitungTotalHalaman(html) };
}

export function urlBerkas(path: string | null | undefined): string | null {
  if (!path) return null;
  const p = String(path).trim();
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) {
    // Jika URL absolut menunjuk ke host EP internal, rutekan via proxy /ep agar bisa diakses di Tauri
    // (webview tidak punya cookie/session ke domain asli dan host tertentu bisa diblokir).
    try {
      const u = new URL(p);
      const internal = /(presensi|absen|epresensi)/i.test(u.hostname) || u.pathname.includes('/p/');
      if (internal) return apiUrl(`${PROXY}${u.pathname}${u.search}`);
    } catch { /* abaikan */ }
    return p;
  }
  if (p.startsWith('/ep/')) return apiUrl(p);
  if (p.startsWith('/')) return apiUrl(`${PROXY}${p}`);
  return apiUrl(`${PROXY}/${p.replace(/^\/+/, '')}`);
}

export async function ambilBerkas(path: string): Promise<{ blob: Blob; contentType: string }> {
  const url = urlBerkas(path);
  if (!url) throw new Error('Path berkas tidak valid.');
  const res = await req(url);
  if (!res.ok) throw new Error(`Gagal memuat berkas (HTTP ${res.status})`);
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const blob = await res.blob();
  return { blob, contentType: ct || blob.type || '' };
}
