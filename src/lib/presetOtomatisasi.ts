/**
 * Unified preset automation storage (multi-profile, optional photo stock for Ponorogo).
 * - BKD profiles: location pool + workcode
 * - Ponorogo profile: stock photo + shuffled queue per preset (photo attachment flow)
 * Data stored in IndexedDB and scoped by `${profileId}::${username}`.
 */

import type { ServerProfileId } from './serverProfiles';

export type TipePreset = 'datang' | 'pulang' | 'custom';
export type HariKerja = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface PresetOtomatisasi {
  id: string;
  nama: string;
  tipe: TipePreset;
  /** BKD/location pool mode */
  lokasiIds: string[];
  /** BKD workcode id (string) */
  workcodeId: string;
  /** Ponorogo/photo mode: selected stock photo ids */
  stockFotoIds?: string[];
  jamMulai: string;
  jamSelesai: string;
  hariAktif: HariKerja[];
  aktif: boolean;
  dibuatPada: number;
  diperbarui: number;
}

export interface LogEksekusi {
  presetId: string;
  tanggal: string; // YYYY-MM-DD WIB
  lokasiDipilih?: string;
  fotoDipilih?: string;
  eksekusiPada: number;
  berhasil: boolean;
  pesan?: string;
}

export interface StockFoto {
  id: string;
  nama: string;
  dataUrl: string;
  ukuranAsli: number;
  lebarPx: number;
  tinggiPx: number;
  dibuatPada: number;
}

const DB_NAME = 'presensi-automasi';
const DB_VERSION = 2;
const STORE_AKUN = 'preset-akun';
const STORE_LOG = 'preset-log';
const STORE_FOTO = 'stock-foto';
const STORE_QUEUE = 'foto-queue';

export const MAX_LOKASI_POOL = 20;
export const MAX_STOCK_FOTO = 20;

export const LABEL_HARI: Record<HariKerja, string> = { 0: 'Min', 1: 'Sen', 2: 'Sel', 3: 'Rab', 4: 'Kam', 5: 'Jum', 6: 'Sab' };
export const LABEL_HARI_PANJANG: Record<HariKerja, string> = { 0: 'Minggu', 1: 'Senin', 2: 'Selasa', 3: 'Rabu', 4: 'Kamis', 5: "Jum'at", 6: 'Sabtu' };
export const URUTAN_HARI: HariKerja[] = [1, 2, 3, 4, 5, 6, 0];

interface RekamanPreset { akun: string; presets: PresetOtomatisasi[] }
interface RekamanLog { kunci: string; logs: LogEksekusi[] }
interface RekamanQueue { kunci: string; antrian: string[] }

let databasePromise: Promise<IDBDatabase> | null = null;
function isBrowser(): boolean { return typeof window !== 'undefined' && typeof indexedDB !== 'undefined'; }

function bukaDatabase(): Promise<IDBDatabase> {
  if (!isBrowser()) return Promise.reject(new Error('IndexedDB tidak tersedia di perangkat ini.'));
  if (databasePromise) return databasePromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_AKUN)) db.createObjectStore(STORE_AKUN, { keyPath: 'akun' });
      if (!db.objectStoreNames.contains(STORE_LOG)) db.createObjectStore(STORE_LOG, { keyPath: 'kunci' });
      if (!db.objectStoreNames.contains(STORE_FOTO)) db.createObjectStore(STORE_FOTO, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_QUEUE)) db.createObjectStore(STORE_QUEUE, { keyPath: 'kunci' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Gagal membuka penyimpanan preset.'));
    request.onblocked = () => reject(new Error('Tutup tab lain untuk memperbarui penyimpanan preset.'));
  });
  databasePromise = opening.catch(err => { databasePromise = null; throw err; });
  return databasePromise!;
}

function sanitizePart(v: string): string {
  return String(v ?? '').trim().replace(/[/\\.#$[\]]/g, '_').slice(0, 64) || 'x';
}
export function scopeKey(profileId: ServerProfileId | string | undefined, username: string): string {
  const p = sanitizePart(profileId || 'default');
  const u = sanitizePart(username || 'tanpa-nama');
  return `${p}::${u}`;
}

function buatId(): string {
  try { if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID(); } catch {}
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function reqResult<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

async function bacaRekamanPreset(akun: string): Promise<RekamanPreset | null> {
  const db = await bukaDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AKUN, 'readonly');
    const req = tx.objectStore(STORE_AKUN).get(akun);
    let hasil: RekamanPreset | null = null;
    req.onsuccess = () => {
      const r = req.result as RekamanPreset | undefined;
      if (r && typeof r === 'object' && Array.isArray(r.presets)) hasil = r;
    };
    tx.oncomplete = () => resolve(hasil);
    tx.onerror = () => reject(tx.error ?? new Error('Gagal membaca preset.'));
    tx.onabort = () => reject(tx.error ?? new Error('Pembacaan preset dibatalkan.'));
  });
}
async function tulisRekamanPreset(record: RekamanPreset): Promise<void> {
  const db = await bukaDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AKUN, 'readwrite');
    tx.objectStore(STORE_AKUN).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Gagal menyimpan preset.'));
    tx.onabort = () => reject(tx.error ?? new Error('Penyimpanan preset dibatalkan.'));
  });
}

function kunciLog(akun: string, tanggal: string): string { return `${akun}__${tanggal}`; }
async function bacaRekamanLog(akun: string, tanggal: string): Promise<RekamanLog | null> {
  const db = await bukaDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_LOG, 'readonly');
    const req = tx.objectStore(STORE_LOG).get(kunciLog(akun, tanggal));
    let hasil: RekamanLog | null = null;
    req.onsuccess = () => {
      const r = req.result as RekamanLog | undefined;
      if (r && typeof r === 'object' && Array.isArray(r.logs)) hasil = r;
    };
    tx.oncomplete = () => resolve(hasil);
    tx.onerror = () => reject(tx.error ?? new Error('Gagal membaca log preset.'));
    tx.onabort = () => reject(tx.error ?? new Error('Pembacaan log preset dibatalkan.'));
  });
}
async function tulisRekamanLog(record: RekamanLog): Promise<void> {
  const db = await bukaDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_LOG, 'readwrite');
    tx.objectStore(STORE_LOG).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Gagal menyimpan log preset.'));
    tx.onabort = () => reject(tx.error ?? new Error('Penyimpanan log preset dibatalkan.'));
  });
}

// Backward-compatible APIs (default scope without profile = 'default')

export async function bacaSemuaPreset(username: string, profileId?: string): Promise<PresetOtomatisasi[]> {
  try { const record = await bacaRekamanPreset(scopeKey(profileId, username)); return (record?.presets ?? []).map(normalizePreset); } catch { return []; }
}
export async function simpanSemuaPreset(username: string, presets: PresetOtomatisasi[], profileId?: string): Promise<void> {
  await tulisRekamanPreset({ akun: scopeKey(profileId, username), presets });
}
function normalizePreset(p: any): PresetOtomatisasi {
  return {
    id: String(p.id ?? ''),
    nama: String(p.nama ?? ''),
    tipe: (p.tipe === 'pulang' || p.tipe === 'custom') ? p.tipe : 'datang',
    lokasiIds: Array.isArray(p.lokasiIds) ? p.lokasiIds.map(String) : [],
    workcodeId: String(p.workcodeId ?? ''),
    stockFotoIds: Array.isArray(p.stockFotoIds) ? p.stockFotoIds.map(String) : undefined,
    jamMulai: String(p.jamMulai ?? '07:00'),
    jamSelesai: String(p.jamSelesai ?? '09:00'),
    hariAktif: Array.isArray(p.hariAktif) ? p.hariAktif : [1,2,3,4,5],
    aktif: Boolean(p.aktif),
    dibuatPada: Number(p.dibuatPada ?? Date.now()),
    diperbarui: Number(p.diperbarui ?? Date.now()),
  };
}

export async function tambahPreset(username: string, preset: Omit<PresetOtomatisasi, 'id' | 'dibuatPada' | 'diperbarui'>, profileId?: string): Promise<PresetOtomatisasi> {
  const sekarang = Date.now();
  const baru: PresetOtomatisasi = { ...preset, id: buatId(), dibuatPada: sekarang, diperbarui: sekarang };
  const daftar = await bacaSemuaPreset(username, profileId);
  await simpanSemuaPreset(username, [...daftar, baru], profileId);
  return baru;
}
export async function perbaruiPreset(username: string, id: string, perubahan: Partial<PresetOtomatisasi>, profileId?: string): Promise<PresetOtomatisasi | null> {
  const daftar = await bacaSemuaPreset(username, profileId);
  let hasilUpdate: PresetOtomatisasi | null = null;
  const daftarBaru = daftar.map(p => { if (p.id !== id) return p; hasilUpdate = { ...p, ...perubahan, id, diperbarui: Date.now() }; return hasilUpdate; });
  if (hasilUpdate !== null) await simpanSemuaPreset(username, daftarBaru, profileId);
  if (perubahan.stockFotoIds) await resetAntrianFoto(id).catch(()=>{});
  return hasilUpdate;
}
export async function hapusPreset(username: string, id: string, profileId?: string): Promise<void> {
  const daftar = await bacaSemuaPreset(username, profileId);
  await simpanSemuaPreset(username, daftar.filter(p => p.id !== id), profileId);
  await resetAntrianFoto(id).catch(()=>{});
}
export async function toggleAktifPreset(username: string, id: string, profileId?: string): Promise<PresetOtomatisasi | null> {
  const daftar = await bacaSemuaPreset(username, profileId);
  const target = daftar.find(p => p.id === id);
  if (!target) return null;
  return perbaruiPreset(username, id, { aktif: !target.aktif }, profileId);
}

export async function bacaLogHarian(username: string, tanggal: string, profileId?: string): Promise<LogEksekusi[]> {
  try { const record = await bacaRekamanLog(scopeKey(profileId, username), tanggal); return record?.logs ?? []; } catch { return []; }
}
export async function tulisLog(username: string, log: LogEksekusi, profileId?: string): Promise<void> {
  const akun = scopeKey(profileId, username);
  const daftar = await bacaLogHarian(username, log.tanggal, profileId);
  const idx = daftar.findIndex(l => l.presetId === log.presetId);
  if (idx >= 0) daftar[idx] = log; else daftar.push(log);
  await tulisRekamanLog({ kunci: kunciLog(akun, log.tanggal), logs: daftar });
}
export async function sudahDieksekusiHariIni(username: string, presetId: string, tanggal: string, profileId?: string): Promise<boolean> {
  const daftar = await bacaLogHarian(username, tanggal, profileId);
  return daftar.some(l => l.presetId === presetId && l.berhasil);
}

// Pure helpers
export function pilihLokasiAcak(lokasiIds: string[]): string | null {
  if (lokasiIds.length === 0) return null;
  return lokasiIds[Math.floor(Math.random() * lokasiIds.length)];
}
function keMenit(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return -1;
  const h = Number(m[1]), mm = Number(m[2]);
  return h >= 0 && h < 24 && mm >= 0 && mm < 60 ? h * 60 + mm : -1;
}
export function dalamRentangWaktu(jamMulai: string, jamSelesai: string, jamSekarang: string): boolean {
  const mulai = keMenit(jamMulai), selesai = keMenit(jamSelesai), sekarang = keMenit(jamSekarang);
  if (mulai < 0 || selesai < 0 || sekarang < 0) return false;
  if (mulai <= selesai) return mulai <= sekarang && sekarang <= selesai;
  return sekarang >= mulai || sekarang <= selesai;
}
export function waktuAcakPreset(presetId: string, tanggal: string, jamMulai: string, jamSelesai: string): string | null {
  const mulai = keMenit(jamMulai), selesai = keMenit(jamSelesai);
  if (mulai < 0 || selesai < 0 || !tanggal) return null;
  const durasi = (selesai - mulai + 1440) % 1440;
  const seed = `${presetId}:${tanggal}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  const menitTerpilih = (mulai + ((hash >>> 0) % (durasi + 1))) % 1440;
  return `${String(Math.floor(menitTerpilih / 60)).padStart(2, '0')}:${String(menitTerpilih % 60).padStart(2, '0')}`;
}
export function waktuAcakPresetSudahTiba(presetId: string, tanggal: string, jamMulai: string, jamSelesai: string, jamSekarang: string): boolean {
  const mulai = keMenit(jamMulai), selesai = keMenit(jamSelesai), sekarang = keMenit(jamSekarang);
  const target = waktuAcakPreset(presetId, tanggal, jamMulai, jamSelesai);
  if (mulai < 0 || selesai < 0 || sekarang < 0 || !target) return false;
  const durasi = (selesai - mulai + 1440) % 1440;
  const waktuBerjalan = (sekarang - mulai + 1440) % 1440;
  const targetBerjalan = (keMenit(target) - mulai + 1440) % 1440;
  return waktuBerjalan <= durasi && waktuBerjalan >= targetBerjalan;
}
export function hariIniAktif(hariAktif: HariKerja[], hariSekarang: number): boolean {
  return hariAktif.includes(hariSekarang as HariKerja);
}

// Stock photos (shared pool, usable by Ponorogo presets)
export async function bacaSemuaStockFoto(): Promise<StockFoto[]> {
  const db = await bukaDatabase();
  const tx = db.transaction(STORE_FOTO, 'readonly');
  return reqResult<StockFoto[]>(tx.objectStore(STORE_FOTO).getAll());
}
export async function bacaStockFotoById(id: string): Promise<StockFoto | undefined> {
  const db = await bukaDatabase();
  const tx = db.transaction(STORE_FOTO, 'readonly');
  return reqResult<StockFoto | undefined>(tx.objectStore(STORE_FOTO).get(id));
}
export async function tambahStockFoto(data: Omit<StockFoto, 'id' | 'dibuatPada'>): Promise<StockFoto> {
  const db = await bukaDatabase();
  const jumlah = await new Promise<number>((res, rej) => {
    const tx = db.transaction(STORE_FOTO, 'readonly');
    const req = tx.objectStore(STORE_FOTO).count();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  if (jumlah >= MAX_STOCK_FOTO) throw new Error(`Batas ${MAX_STOCK_FOTO} foto sudah tercapai.`);
  const foto: StockFoto = { ...data, id: buatId(), dibuatPada: Date.now() };
  const tx2 = db.transaction(STORE_FOTO, 'readwrite');
  tx2.objectStore(STORE_FOTO).put(foto);
  await new Promise<void>((res, rej) => { tx2.oncomplete = () => res(); tx2.onerror = () => rej(tx2.error); });
  return foto;
}
export async function hapusStockFoto(id: string): Promise<void> {
  const db = await bukaDatabase();
  const tx = db.transaction(STORE_FOTO, 'readwrite');
  tx.objectStore(STORE_FOTO).delete(id);
  await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

// Photo queue (round-robin per preset)
function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export async function ambilFotoBerikutnya(presetId: string, stockFotoIds: string[]): Promise<string | null> {
  if (!stockFotoIds.length) return null;
  const db = await bukaDatabase();
  const tx = db.transaction(STORE_QUEUE, 'readwrite');
  const store = tx.objectStore(STORE_QUEUE);
  const row = await reqResult<RekamanQueue | undefined>(store.get(presetId));
  const valid = new Set(stockFotoIds);
  let antrian = (row?.antrian ?? []).filter(id => valid.has(id));
  if (antrian.length === 0) antrian = shuffleArray(stockFotoIds);
  const dipilih = antrian[0] ?? null;
  const sisanya = antrian.slice(1);
  store.put({ kunci: presetId, antrian: sisanya });
  await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  return dipilih;
}
export async function resetAntrianFoto(presetId: string): Promise<void> {
  const db = await bukaDatabase();
  const tx = db.transaction(STORE_QUEUE, 'readwrite');
  tx.objectStore(STORE_QUEUE).delete(presetId);
  await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
export async function bacaStatusAntrian(presetId: string, stockFotoIds: string[]): Promise<{ terpakai: number; sisa: number; total: number }> {
  const total = stockFotoIds.length;
  if (total === 0) return { terpakai: 0, sisa: 0, total: 0 };
  const db = await bukaDatabase();
  const tx = db.transaction(STORE_QUEUE, 'readonly');
  const row = await reqResult<RekamanQueue | undefined>(tx.objectStore(STORE_QUEUE).get(presetId));
  const valid = new Set(stockFotoIds);
  const antrian = (row?.antrian ?? []).filter(id => valid.has(id));
  const sisa = antrian.length;
  return { terpakai: total - sisa, sisa, total };
}

// Event helpers (compat)
export function notifyPresetUpdated(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('presensi-automasi-updated'));
}
