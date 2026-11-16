/** Titik lokal per akun disimpan di IndexedDB; tersinkron ke Firebase (cloud_sync) bila konteks akun/profil tersedia. */
import { pullCloudData, pushCloudData } from './cloudSync';

export interface TitikAbsen {
  id: string;
  nama: string;
  latitude: number;
  longitude: number;
  /** Tandai sebagai koordinat yang dipakai untuk absensi. */
  dipakai: boolean;
  dibuatPada: number;
}

/** Batas jumlah titik per akun. */
const MAX_TITIK = 40;
const DB_NAME = 'presensi-lokasi';
const DB_VERSION = 1;
const STORE_NAME = 'akun';

interface RekamanTitik {
  akun: string;
  titik: TitikAbsen[];
  aktifId: string | null;
}

let databasePromise: Promise<IDBDatabase> | null = null;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

/**
 * Sanitasi username untuk dipakai sebagai bagian kunci.
 *
 * Karakter `/` dan `#` tidak boleh muncul di
 * nama dokumen, dan mengizinkan apa adanya berarti `budi/../sari` bisa
 * menimpa kunci akun lain.
 */
function sanitizeKeyPart(username: string): string {
  const bersih = String(username ?? '')
    .trim()
    .replace(/[/\\.#$[\]]/g, '_')
    .slice(0, 64);
  return bersih || 'tanpa-nama';
}

function kunciAkun(username: string, profileId?: string): string {
  const u = sanitizeKeyPart(username);
  if (profileId) return `${sanitizeKeyPart(profileId)}::${u}`;
  return u;
}

/** Kunci localStorage lama, hanya dipakai untuk migrasi satu kali. */
export function kunciTitik(username: string, profileId?: string): string {
  return `epresensi_jatim_lokasi__${kunciAkun(username, profileId)}`;
}

/** Kunci localStorage lama, hanya dipakai untuk migrasi satu kali. */
function kunciTitikAktif(username: string, profileId?: string): string {
  return `epresensi_jatim_lokasi_aktif__${kunciAkun(username, profileId)}`;
}

function bukaDatabase(): Promise<IDBDatabase> {
  if (!isBrowser()) return Promise.reject(new Error('IndexedDB tidak tersedia di perangkat ini.'));
  if (databasePromise) return databasePromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'akun' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Gagal membuka penyimpanan lokasi.'));
    request.onblocked = () => reject(new Error('Tutup tab aplikasi lain untuk memperbarui penyimpanan lokasi.'));
  });
  databasePromise = opening.catch(error => {
    databasePromise = null;
    throw error;
  });
  return databasePromise!;
}

function saringTitik(item: any): TitikAbsen | null {
  if (!item || typeof item !== 'object') return null;
  const latitude = Number(item.latitude);
  const longitude = Number(item.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return {
    id: String(item.id ?? `lokal-${Math.random().toString(36).slice(2, 10)}`),
    nama: String(item.nama ?? 'Tanpa nama').slice(0, 120),
    latitude,
    longitude,
    dipakai: Boolean(item.dipakai),
    dibuatPada: Number(item.dibuatPada) || Date.now(),
  };
}

function normalisasiRekaman(value: unknown, akun: string): RekamanTitik | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<RekamanTitik>;
  const titik = Array.isArray(record.titik)
    ? record.titik.map(saringTitik).filter((item): item is TitikAbsen => item !== null).slice(0, MAX_TITIK)
    : [];
  const aktifId = typeof record.aktifId === 'string' && titik.some(item => item.id === record.aktifId)
    ? record.aktifId
    : null;
  return { akun, titik, aktifId };
}

async function bacaRekamanDatabase(username: string, profileId?: string): Promise<RekamanTitik | null> {
  const database = await bukaDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(kunciAkun(username, profileId));
    let result: RekamanTitik | null = null;
    request.onsuccess = () => {
      result = normalisasiRekaman(request.result, kunciAkun(username, profileId));
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error ?? new Error('Gagal membaca titik absen.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Pembacaan titik absen dibatalkan.'));
  });
}

async function tulisRekaman(record: RekamanTitik): Promise<void> {
  const database = await bukaDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Gagal menyimpan titik absen.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Penyimpanan titik absen dibatalkan.'));
  });
}

async function hapusRekamanDatabase(username: string, profileId?: string): Promise<void> {
  const database = await bukaDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(kunciAkun(username, profileId));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Gagal menghapus titik absen.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Penghapusan titik absen dibatalkan.'));
  });
}

async function bacaRekaman(username: string, profileId?: string): Promise<RekamanTitik | null> {
  if (!username) return null;
  const tersimpan = await bacaRekamanDatabase(username, profileId);
  if (tersimpan) return tersimpan;

  if (typeof localStorage === 'undefined') return null;
  const kunciDaftar = kunciTitik(username, profileId);
  const raw = localStorage.getItem(kunciDaftar);
  if (!raw) {
    // fallback: coba kunci lama tanpa profileId bila profileId diberikan
    if (profileId) {
      const legacy = await bacaRekamanDatabase(username);
      if (legacy) return legacy;
    }
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    localStorage.removeItem(kunciDaftar);
    localStorage.removeItem(kunciTitikAktif(username, profileId));
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const titik = parsed.map(saringTitik).filter((item): item is TitikAbsen => item !== null).slice(0, MAX_TITIK);
  const requestedActive = localStorage.getItem(kunciTitikAktif(username, profileId));
  const aktifId = requestedActive && titik.some(item => item.id === requestedActive) ? requestedActive : null;
  const record = { akun: kunciAkun(username, profileId), titik, aktifId };
  await tulisRekaman(record);
  localStorage.removeItem(kunciDaftar);
  localStorage.removeItem(kunciTitikAktif(username, profileId));
  return record;
}

/** Pindahkan titik akun lama saat username berubah; data titik tidak dikirim ke server. */
export async function migrasiTitikUsernameLokal(usernameBaru: string, usernameSebelumnya: string[], profileId?: string): Promise<void> {
  if (!usernameBaru || !Array.isArray(usernameSebelumnya)) return;
  const tujuan = await bacaRekaman(usernameBaru, profileId);
  if (tujuan) return;
  for (const usernameLama of usernameSebelumnya) {
    if (!usernameLama || kunciAkun(usernameLama, profileId) === kunciAkun(usernameBaru, profileId)) continue;
    const asal = await bacaRekaman(usernameLama, profileId);
    if (!asal) continue;
    await tulisRekaman({ ...asal, akun: kunciAkun(usernameBaru, profileId) });
    await hapusRekamanDatabase(usernameLama, profileId);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(kunciTitik(usernameLama, profileId));
      localStorage.removeItem(kunciTitikAktif(usernameLama, profileId));
    }
    return;
  }
}

function namaKosong(): never {
  throw new Error('Username wajib diisi untuk menyimpan titik absen.');
}

/** Baca daftar titik akun dari IndexedDB. */
export async function bacaTitik(username: string, profileId?: string): Promise<TitikAbsen[]> {
  return (await bacaRekaman(username, profileId))?.titik ?? [];
}

/** Simpan daftar titik akun ke IndexedDB. */
export async function simpanTitik(username: string, items: TitikAbsen[], profileId?: string): Promise<TitikAbsen[]> {
  if (!username) namaKosong();
  const trimmed = items.map(saringTitik).filter((item): item is TitikAbsen => item !== null).slice(0, MAX_TITIK);
  const current = await bacaRekaman(username, profileId);
  const aktifId = current?.aktifId && trimmed.some(item => item.id === current.aktifId) ? current.aktifId : null;
  await tulisRekaman({ akun: kunciAkun(username, profileId), titik: trimmed, aktifId });
  return trimmed;
}

/** Tambahkan titik baru ke awal daftar. */
export async function tambahTitik(
  username: string,
  titik: Omit<TitikAbsen, 'id' | 'dibuatPada'>,
  profileId?: string
): Promise<TitikAbsen[]> {
  if (!username) namaKosong();
  const entry: TitikAbsen = {
    ...titik,
    id: `lokal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    dibuatPada: Date.now(),
  };
  return simpanTitik(username, [entry, ...(await bacaTitik(username, profileId))], profileId);
}

/** Hapus satu titik milik `username`. */
export async function hapusTitik(username: string, id: string, profileId?: string): Promise<TitikAbsen[]> {
  const current = await bacaRekaman(username, profileId);
  const titik = (current?.titik ?? []).filter(item => item.id !== id);
  await tulisRekaman({ akun: kunciAkun(username, profileId), titik, aktifId: current?.aktifId === id ? null : current?.aktifId ?? null });
  return titik;
}

/** Bersihkan seluruh titik milik `username`  dan hanya miliknya. */
export async function bersihkanSemua(username: string, profileId?: string): Promise<void> {
  if (!username) return;
  await hapusRekamanDatabase(username, profileId);
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(kunciTitik(username, profileId));
    localStorage.removeItem(kunciTitikAktif(username, profileId));
  }
}

/**
 * Ringkasan titik milik `username`, untuk dikirim ke server.
 *
 * Admin memakai ini untuk melihat lokasi setiap akun, jadi bentuknya
 * sengaja ringkas: nama + koordinat, tanpa `id` internal dan tanpa
 * `dibuatPada` yang tidak berguna di tabel.
 */
export interface RingkasanTitik {
  nama: string;
  latitude: number;
  longitude: number;
  dipakai: boolean;
}

export async function ringkasanTitik(username: string, profileId?: string): Promise<RingkasanTitik[]> {
  return (await bacaTitik(username, profileId)).map(item => ({
    nama: item.nama,
    latitude: item.latitude,
    longitude: item.longitude,
    dipakai: item.dipakai,
  }));
}

// 
//  Titik yang dipakai untuk absensi
// 

/**
 * Titik yang ditandai "dipakai" di halaman Lokasi, milik `username`.
 *
 * Halaman Presensi memakainya sebagai koordinat yang dikirim ke `absen` /
 * `cekabsen` lewat `last_latlong`, jadi pengguna tidak perlu GPS sama
 * sekali. Kalau akun ini belum punya yang ditandai, pemanggil harus
 * menanyakan lewat peta  **bukan** jatuh ke titik milik akun lain.
 */
export async function bacaTitikAktif(username: string, profileId?: string): Promise<TitikAbsen | null> {
  const record = await bacaRekaman(username, profileId);
  return record?.titik.find(item => item.id === record.aktifId) ?? null;
}

/** Tandai titik sebagai koordinat absen (radio  satu titik saja). */
export async function setTitikAktif(username: string, id: string, profileId?: string): Promise<void> {
  if (!username) return;
  const record = await bacaRekaman(username, profileId);
  const sekarang = record?.titik ?? [];
  const ada = sekarang.some(item => item.id === id);
  if (!ada) return;
  await tulisRekaman({
    akun: kunciAkun(username, profileId),
    titik: sekarang.map(item => ({ ...item, dipakai: item.id === id })),
    aktifId: id,
  });
}

/** Kosongkan pilihan titik absen milik `username`. */
export async function clearTitikAktif(username: string, profileId?: string): Promise<void> {
  const record = await bacaRekaman(username, profileId);
  if (!record) return;
  await tulisRekaman({
    ...record,
    aktifId: null,
    titik: record.titik.map(item => ({ ...item, dipakai: false })),
  });
}

/**
 * Kunci satu titik milik `username` sebagai satu-satunya yang dipakai.
 *
 * Dipakai setelah absen berhasil: server memvalidasi geofence terhadap
 * koordinat yang dikirim, jadi memindahkan titik "dipakai" ke lokasi yang
 * baru saja dipakai membuat absen berikutnya konsisten.
 */
export async function jadikanAktif(username: string, titik: Omit<TitikAbsen, 'id' | 'dibuatPada'>, profileId?: string): Promise<TitikAbsen[]> {
  const record = await bacaRekaman(username, profileId);
  const list = record?.titik ?? [];
  const ada = list.find(
    item =>
      Math.abs(item.latitude - titik.latitude) < 1e-6 && Math.abs(item.longitude - titik.longitude) < 1e-6
  );

  if (ada) {
    const aktif = list.map(item => ({ ...item, dipakai: item.id === ada.id }));
    await tulisRekaman({ akun: kunciAkun(username), titik: aktif, aktifId: ada.id });
    return aktif;
  }

  /*
   * Titik baru.
   *
   *  Penunjuk aktif **harus** ditulis di sini juga, bukan cuma flag
  * `dipakai`. `bacaTitikAktif()` memakai `aktifId` pada record IndexedDB,
  * jadi kalau hanya flag-nya yang di-set, fungsi itu mengembalikan `null`,
  * `useServerContext` mengirim `last_latlong: ''`, dan tombol "Cek Absensi"
  * tetap terkunci walaupun titik baru saja dibuat.
   *
   * Gejalanya menipu: pengguna melihat "Kantor Pusat" ditandai aktif
   * di daftar, lalu absennya ditolak karena koordinat kosong  dan tidak ada
   * yang menyuruh dia melihat ke mana pun untuk memperbaikinya.
   */
  const baru: TitikAbsen = {
    ...titik,
    id: `lokal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    dibuatPada: Date.now(),
    dipakai: true,
  };
  const hasil = [baru, ...list].slice(0, MAX_TITIK);
  await tulisRekaman({ akun: kunciAkun(username), titik: hasil, aktifId: baru.id });
  return hasil;
}

// 
//  Kebersihan
// 

/**
 * Kunci lama yang menyimpan daftar titik **bersama**.
 *
 * Hanya dihapus, tidak pernah dibaca. Membacanya lalu memindahkannya ke
 * akun yang sedang login justru meneruskan kebocoran yang sama: data yang
 * tidak diketahui asalnya dipindahkan ke orang yang kebetulan masuk terakhir.
 */
const KUNCI_LEGACY = ['epresensi_jatim_lokasi_saya', 'epresensi_jatim_lokasi_aktif'] as const;

/** Buang kunci lama yang menyimpan titik bersama antar akun. */
export function buangTitikLegacy(): void {
  if (!isBrowser()) return;
  try {
    for (const kunci of KUNCI_LEGACY) localStorage.removeItem(kunci);
  } catch {
    // diam-diam
  }
}


// --- Cloud sync (Firestore) ---

function normalizeCloudTitik(input: any): TitikAbsen[] {
  if (!Array.isArray(input)) return [];
  return input.map(saringTitik).filter((x): x is TitikAbsen => !!x).slice(0, MAX_TITIK);
}

export async function syncLokasiFromCloud(accountKey: string, profileId: string, username: string): Promise<RekamanTitik | null> {
  if (!accountKey || !profileId || !username) return null;
  const cloud = await pullCloudData('lokasi', accountKey, profileId, username);
  if (!cloud) return await bacaRekaman(username, profileId);
  const cloudUpdatedAt = Number(cloud.updatedAt || 0);
  const local = await bacaRekaman(username, profileId);
  const localUpdatedAt = Number((local as any)?.updatedAt || 0);
  const cloudTitik = normalizeCloudTitik(cloud.titik);
  const cloudAktifId = typeof cloud.aktifId === 'string' ? cloud.aktifId : null;
  if (!local || cloudUpdatedAt >= localUpdatedAt) {
    const rec: any = { akun: kunciAkun(username, profileId), titik: cloudTitik, aktifId: cloudAktifId && cloudTitik.some(t => t.id === cloudAktifId) ? cloudAktifId : null, updatedAt: cloudUpdatedAt || Date.now() };
    await tulisRekaman(rec);
    return rec as RekamanTitik;
  }
  // local newer -> push
  await pushLokasiToCloud(accountKey, profileId, username, local).catch(() => {});
  return local;
}

export async function pushLokasiToCloud(accountKey: string, profileId: string, username: string, rec?: RekamanTitik | null): Promise<void> {
  if (!accountKey || !profileId || !username) return;
  const record = rec || await bacaRekaman(username, profileId);
  if (!record) return;
  const payload = {
    titik: (record.titik || []).slice(0, MAX_TITIK),
    aktifId: record.aktifId || null,
    updatedAt: Date.now(),
  };
  await pushCloudData('lokasi', accountKey, profileId, username, payload);
  try { await tulisRekaman({ ...(record as any), updatedAt: payload.updatedAt }); } catch {}
}
