import { rpcGetWorkCode, rpcLogin, type ProfilPegawai } from './apiCalls';
import { getServerSessionCache, setServerSessionCache, clearServerSessionCache } from './cacheManager';
import { absenTimeoutMs } from './presensiContract';
import { fotoProfileValid } from './viewModels';
import { getServerProfile, type ServerProfileId } from './serverProfiles';
import { apiUrl } from './apiBase';

const KELUAR_KEY_PREFIX = 'presensi_server_keluar_';
const IMEI_KEY_PREFIX = 'presensi_imei_';

function isBrowser(): boolean { return typeof window !== 'undefined'; }
function keluarKey(username: string, profileId: ServerProfileId) { return `${KELUAR_KEY_PREFIX}${profileId}_${username.trim()}`; }
function imeiKey(username: string, profileId: ServerProfileId) { return `${IMEI_KEY_PREFIX}${profileId}_${username.trim()}`; }

export function sudahKeluarServer(username: string, profileId: ServerProfileId = 'jatim'): boolean {
  if (!isBrowser()) return false;
  try { return localStorage.getItem(keluarKey(username, profileId)) === '1'; } catch { return false; }
}
export function tandaiKeluarServer(username: string, profileId: ServerProfileId = 'jatim'): void {
  if (!isBrowser()) return;
  try { localStorage.setItem(keluarKey(username, profileId), '1'); } catch {}
  try { clearServerSessionCache(username); } catch {}
}
export function tandaiAktifServer(username: string, profileId: ServerProfileId = 'jatim'): void {
  if (!isBrowser()) return;
  try { localStorage.removeItem(keluarKey(username, profileId)); } catch {}
}

export function imeiStabil(username: string, profileId: ServerProfileId = 'jatim'): string {
  if (!isBrowser()) return '';
  try {
    const tersimpan = localStorage.getItem(imeiKey(username, profileId));
    if (tersimpan) return tersimpan;
    const baru = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `tm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(imeiKey(username, profileId), baru);
    return baru;
  } catch { return ''; }
}

export function simpanImei(username: string, imei: string, profileId: ServerProfileId = 'jatim'): void {
  if (!isBrowser() || !imei) return;
  try { localStorage.setItem(imeiKey(username, profileId), imei); } catch {}
}

export interface ProfilPegawaiResult {
  apiKey: string;
  id: string;
  nip: string;
  nama: string;
  jabatan: string;
  instansi: string;
  kodeInstansi: string;
  departemen: string;
  group: string;
  groupId: string;
  departmentId: string;
  idLokasi: string;
  kodeUnor: string;
  profilePic: string;
  usingWajah: number;
  usingWajahDariServer: number;
  usingWajahServer: number;
  allowWfh: number;
  vektorApproved: number;
  absenTimeout: number;
  logoDepartemen: string;
  labelWfh: string;
  imei: string;
  modul: { home: number; presensi: number; perizinan: number; laporan: number };
  [key: string]: unknown;
}

export type PegawaiProfile = ProfilPegawaiResult;

export function toPegawaiProfile(result: ProfilPegawai, imei = ''): ProfilPegawaiResult {
  return {
    apiKey: String(result.api_key ?? ''),
    id: String(result.pegawai_id ?? ''),
    nip: (result as any).nip ?? '',
    nama: result.nama ?? '',
    jabatan: result.jabatan ?? '',
    instansi: '',
    kodeInstansi: '',
    departemen: result.departemen ?? '',
    group: result.group_name ?? '',
    groupId: String(result.group_id ?? ''),
    departmentId: String(result.departemen_id ?? ''),
    idLokasi: '',
    kodeUnor: '',
    profilePic: fotoProfileValid(result.foto_profile),
    usingWajah: Number(result.upload_wajah ?? 0),
    usingWajahDariServer: Number(result.upload_wajah ?? 0),
    usingWajahServer: Number(result.using_wajah ?? 0),
    allowWfh: Number(result.allow_wfh ?? 0),
    vektorApproved: Number(result.vektor_approved ?? 0),
    absenTimeout: absenTimeoutMs(result),
    logoDepartemen: result.logo_departemen ?? '',
    labelWfh: result.label_wfh ?? '',
    imei,
    modul: {
      home: Number(result.home ?? 1),
      presensi: Number(result.presensi ?? 1),
      perizinan: Number(result.perizinan ?? 1),
      laporan: Number(result.laporan ?? 1),
    },
  };
}

function toPonorogoProfile(data: any, nip: string, imei = ''): ProfilPegawaiResult {
  const id = String(data?.id ?? data?.id_pegawai ?? data?.pegawai_id ?? '');
  const deviceId = String(data?.emai ?? data?.imei ?? data?.device_id ?? data?.deviceId ?? data?.sim_serial ?? imei ?? '');
  return {
    apiKey: String(data?.api_key ?? data?.token ?? ''),
    id,
    nip: String(data?.nip ?? nip ?? ''),
    nama: String(data?.nama ?? data?.nama_pegawai ?? ''),
    jabatan: String(data?.nama_jabatan ?? data?.jabatan ?? ''),
    instansi: String(data?.nama_instansi ?? data?.instansi ?? ''),
    kodeInstansi: String(data?.kode_instansi ?? data?.kodeInstansi ?? ''),
    departemen: String(data?.departemen ?? data?.nama_instansi ?? ''),
    group: String(data?.group_name ?? ''),
    groupId: String(data?.group_id ?? ''),
    departmentId: String(data?.departemen_id ?? ''),
    idLokasi: String(data?.id_lokasi ?? data?.idLokasi ?? ''),
    kodeUnor: String(data?.kode_unor ?? data?.kodeUnor ?? data?.unor ?? ''),
    profilePic: String(data?.foto ?? data?.foto_profile ?? ''),
    usingWajah: Number(data?.using_wajah ?? data?.upload_wajah ?? 0),
    usingWajahDariServer: Number(data?.upload_wajah ?? 0),
    usingWajahServer: Number(data?.using_wajah ?? 0),
    allowWfh: Number(data?.allow_wfh ?? 0),
    vektorApproved: Number(data?.vektor_approved ?? 0),
    absenTimeout: 300_000,
    logoDepartemen: String(data?.logo_departemen ?? ''),
    labelWfh: String(data?.label_wfh ?? ''),
    imei: deviceId || imei,
    modul: { home: 1, presensi: 1, perizinan: 1, laporan: 1 },
    // keep raw ponorogo fields for ponorogo pages
    _raw: data,
    latitude: String(data?.lat ?? data?.latitude ?? ''),
    longitude: String(data?.long ?? data?.longitude ?? data?.longtitude ?? ''),
    nama_lokasi: String(data?.nama_lokasi ?? ''),
    alamat: String(data?.alamat ?? ''),
    alamat_kantor: String(data?.alamat_kantor ?? ''),
    nama_unit_kerja: String(data?.nama_unit_kerja ?? ''),
    kelas_jabatan: String(data?.kelas_jabatan ?? ''),
  };
}

export type StatusAutoLogin = 'dari-cache' | 'berhasil' | 'belum-ada-kredensial' | 'terkunci-perangkat' | 'kredensial-salah' | 'gagal';
export interface HasilAutoLogin { status: StatusAutoLogin; profile?: ProfilPegawaiResult; imei: string; pesan?: string; }

function simpanSesi(username: string, profile: ProfilPegawaiResult, imei: string): void {
  setServerSessionCache(username, {
    apiKey: profile.apiKey ?? '',
    nip: profile.nip ?? '',
    pegawaiId: profile.id ?? '',
    idLokasi: profile.idLokasi ?? '',
    kodeInstansi: profile.kodeInstansi ?? '',
    kodeUnor: profile.kodeUnor ?? '',
    nama: profile.nama ?? '',
    jabatan: profile.jabatan ?? '',
    instansi: profile.instansi ?? '',
    departemen: profile.departemen ?? '',
    group: profile.group ?? '',
    profilePic: profile.profilePic ?? '',
    usingWajah: profile.usingWajah ?? 0,
    workCode: '',
    imei,
  });
}

function profilDariCache(cached: NonNullable<ReturnType<typeof getServerSessionCache>>): ProfilPegawaiResult {
  return {
    apiKey: cached.apiKey, id: cached.pegawaiId, nip: cached.nip, nama: cached.nama,
    jabatan: cached.jabatan, instansi: cached.instansi, kodeInstansi: cached.kodeInstansi,
    departemen: cached.departemen, group: cached.group, groupId: '', departmentId: '',
    idLokasi: cached.idLokasi, kodeUnor: cached.kodeUnor, profilePic: cached.profilePic,
    usingWajah: cached.usingWajah, usingWajahDariServer: cached.usingWajah, usingWajahServer: 0,
    allowWfh: 0, vektorApproved: 0, absenTimeout: 300_000, logoDepartemen: '', labelWfh: '',
    imei: cached.imei ?? '', modul: { home: 1, presensi: 1, perizinan: 1, laporan: 1 },
  };
}

export async function tokenMasihValid(ctx: { apiKey: string; imei: string }, options: { signal?: AbortSignal } = {}): Promise<boolean> {
  try { const rows = await rpcGetWorkCode(ctx, { signal: options.signal }); return Array.isArray(rows); }
  catch { return true; }
}

async function loginPonorogo(nip: string, password: string, imei: string): Promise<HasilAutoLogin> {
  try {
    const res = await fetch(apiUrl('/api/proxy'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: '/login/do_LoginMobile', payload: { username: nip, password, versi: '2.0.0' } }),
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    if (!res.ok) {
      const detail = String(data?.error || data?.message || data?.msg || data?.raw || text || '').slice(0, 200);
      if (res.status === 502 || res.status === 503 || res.status === 504 || /ECONNREFUSED|Failed to fetch|proxy error/i.test(detail)) {
        return { status: 'gagal', imei, pesan: 'Proxy lokal tidak aktif atau tidak dapat dijangkau (127.0.0.1:14200). Jalankan aplikasi melalui Tauri (npm run tauri:dev/build) atau pastikan server proxy lokal berjalan.' };
      }
      return { status: 'gagal', imei, pesan: detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}` };
    }

    if (data?.success) {
      const profile = toPonorogoProfile(data, nip, imei);
      simpanSesi(nip, profile, imei);
      return { status: 'berhasil', profile, imei: profile.imei || imei };
    }

    const msg = String(data?.message || data?.msg || data?.error || (typeof data?.raw === 'string' ? data.raw : '') || 'Login Ponorogo gagal. Periksa NIP dan password.');
    const terkunci = /imei|perangkat|device|terikat|terkunci/i.test(msg);
    if (/ECONNREFUSED|proxy|127\.0\.0\.1:14200/i.test(msg)) {
      return { status: 'gagal', imei, pesan: 'Proxy lokal tidak aktif (127.0.0.1:14200). Jalankan aplikasi melalui Tauri (npm run tauri:dev/build).' };
    }
    return { status: terkunci ? 'terkunci-perangkat' : 'kredensial-salah', imei, pesan: msg };
  } catch (err: any) {
    const pesan = String(err?.message ?? 'Gagal menghubungi server presensi Ponorogo.');
    if (/Failed to fetch|NetworkError|ECONNREFUSED/i.test(pesan)) {
      return { status: 'gagal', imei, pesan: 'Tidak dapat terhubung ke proxy lokal (127.0.0.1:14200). Jalankan aplikasi melalui Tauri (npm run tauri:dev/build) agar proxy Rust aktif.' };
    }
    return { status: 'gagal', imei, pesan };
  }
}

export async function loginServerPusat(
  nip: string,
  password: string,
  profileId: ServerProfileId,
  imeiInput?: string,
): Promise<HasilAutoLogin> {
  const profile = getServerProfile(profileId);
  const imei = (imeiInput || imeiStabil(nip, profileId)).trim();
  if (profile.mode === 'ponorogo-absensi') {
    const hasil = await loginPonorogo(nip, password, imei);
    if (hasil.status === 'berhasil' && imeiInput) simpanImei(nip, imei, profileId);
    return hasil;
  }
  try {
    const hasil = await rpcLogin(nip, password, { imei });
    if (!hasil.ok) {
      const pesan = typeof hasil.pesan === 'string'
        ? hasil.pesan
        : (() => { try { return JSON.stringify(hasil.pesan ?? 'Login gagal.'); } catch { return 'Login gagal.'; } })();
      const perangkat = hasil.perangkatTerikat || /imei|perangkat|device|terikat|terkunci|sudah terdaftar/i.test(pesan);
      return {
        status: perangkat ? 'terkunci-perangkat' : 'kredensial-salah',
        imei,
        pesan,
      };
    }
    const prof = toPegawaiProfile({ ...(hasil.data as any), nip }, imei);
    simpanSesi(nip, prof, imei);
    if (imeiInput) simpanImei(nip, imei, profileId);
    return { status: 'berhasil', profile: prof, imei };
  } catch (err: any) {
    const raw = err?.message ?? err;
    const pesan = typeof raw === 'string' ? raw : (() => { try { return JSON.stringify(raw ?? 'Gagal menghubungi server presensi.'); } catch { return 'Gagal menghubungi server presensi.'; } })();
    if (/HTTP Error 404|HTTP Error 502|HTTP Error 503|Failed to fetch|NetworkError|ECONNREFUSED/i.test(pesan)) {
      return { status: 'gagal', imei, pesan: `${pesan}\n\nPastikan aplikasi dijalankan melalui Tauri (npm run tauri:dev/build) agar proxy lokal 127.0.0.1:14200 aktif, atau proxy dev sudah terhubung.` };
    }
    if (/imei|perangkat|device|terikat|terkunci/i.test(pesan)) {
      return { status: 'terkunci-perangkat', imei, pesan };
    }
    return { status: 'gagal', imei, pesan };
  }
}

// Kompatibilitas dengan pemanggil lama
export async function mulaiAutoLogin(username: string): Promise<HasilAutoLogin> {
  const cached = getServerSessionCache(username);
  if (cached?.apiKey) return { status: 'dari-cache', profile: profilDariCache(cached), imei: cached.imei ?? '' };
  return { status: 'belum-ada-kredensial', imei: '', pesan: 'Silakan login ke server presensi.' };
}
export function ulangAutoLoginTanpaCache(_username: string) {
  const controller = new AbortController();
  return { promise: Promise.resolve({ status: 'gagal' as const, imei: '', pesan: 'Login ulang diperlukan.' }), controller };
}
export function resetAutoLogin(): void { /* no-op */ }
