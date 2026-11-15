// Local-only user manager (offline, no Firebase).
// Stores user accounts in localStorage for this device.
import { AUTOMATION_AVAILABLE } from './deployMode';

export type UserRole = 'admin' | 'user';

export interface TabPermissions {
  tabBeranda: boolean;
  tabAbsen: boolean;
  tabLog: boolean;
  tabInputAktivitas: boolean;
  tabAktivitas: boolean;
  tabReview: boolean;
  tabIzin: boolean;
  tabPengajuanIzin: boolean;
  tabLogPresensiInstansi: boolean;
  tabDatabase: boolean;
  tabUnor: boolean;
  tabReport: boolean;
  tabAutomasi: boolean;
  tabLogPresensiTerkini: boolean;
  tabLogLengkap: boolean;
  reportPerPegawai: boolean;
  reportPerPegawaiAktivitas: boolean;
  reportSkorPerInstansi: boolean;
  reportAktivitasPerInstansi: boolean;
  reportRekapTppAktivitas: boolean;
  allowSearchPegawai: boolean;
  allowSearchDatabase: boolean;
  allowSearchUnor: boolean;
  allowSearchPresensi: boolean;
  allowSearchProduktivitas: boolean;
  allowSearchReview: boolean;
  allowSearchIzin: boolean;
  allowSearchLaporan: boolean;
  allowSearchInstansi: boolean;
  allowEditLoginCredentials: boolean;
}

export interface UserAccount {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  displayName: string;
  permissions: TabPermissions;
  createdAt: number;
  updatedAt: number;
}

export type UserAccountSafe = Omit<UserAccount, 'passwordHash'>;

const USERS_KEY = 'presensi_local_users_v1';
const USERNAME_REGEX = /^[a-z0-9_.-]{2,32}$/;

export const DEFAULT_ADMIN_PERMISSIONS: TabPermissions = {
  tabBeranda: true, tabAbsen: true, tabLog: true,
  tabInputAktivitas: true, tabAktivitas: true, tabReview: true,
  tabIzin: true, tabPengajuanIzin: true, tabLogPresensiInstansi: true, tabDatabase: true,
  tabUnor: true, tabReport: true, tabAutomasi: true,
  tabLogPresensiTerkini: true, tabLogLengkap: true,
  reportPerPegawai: true, reportPerPegawaiAktivitas: true,
  reportSkorPerInstansi: true, reportAktivitasPerInstansi: true,
  reportRekapTppAktivitas: true,
  allowSearchPegawai: true,
  allowSearchDatabase: true,
  allowSearchUnor: true,
  allowSearchPresensi: true,
  allowSearchProduktivitas: true,
  allowSearchReview: true,
  allowSearchIzin: true,
  allowSearchLaporan: true,
  allowSearchInstansi: true,
  allowEditLoginCredentials: true,
};

export const DEFAULT_USER_PERMISSIONS: TabPermissions = {
  tabBeranda: true, tabAbsen: true, tabLog: true,
  tabInputAktivitas: true, tabAktivitas: true, tabReview: true,
  tabIzin: true, tabPengajuanIzin: true, tabLogPresensiInstansi: false, tabDatabase: false,
  tabUnor: false, tabReport: false, tabAutomasi: true,
  tabLogPresensiTerkini: true, tabLogLengkap: true,
  reportPerPegawai: false, reportPerPegawaiAktivitas: false,
  reportSkorPerInstansi: false, reportAktivitasPerInstansi: false,
  reportRekapTppAktivitas: false,
  allowSearchPegawai: false,
  allowSearchDatabase: false,
  allowSearchUnor: false,
  allowSearchPresensi: false,
  allowSearchProduktivitas: false,
  allowSearchReview: false,
  allowSearchIzin: false,
  allowSearchLaporan: false,
  allowSearchInstansi: false,
  allowEditLoginCredentials: false,
};

export function normalizeUserPermissions(raw?: Record<string, unknown>): TabPermissions {
  const merged = { ...DEFAULT_USER_PERMISSIONS, ...(raw || {}) } as any;
  // migrasi: tabLogin (lama) -> tabBeranda (baru)
  if (merged.tabBeranda == null && merged.tabLogin != null) {
    merged.tabBeranda = merged.tabLogin;
  }
  delete merged.tabLogin;
  delete merged.tabLokasi;
  const permissions = merged as TabPermissions;
  permissions.tabBeranda = true;
  if (!AUTOMATION_AVAILABLE) permissions.tabAutomasi = false;
  return permissions;
}

export const TAB_PERMISSION_LABELS: Record<keyof TabPermissions, string> = {
  tabBeranda: 'Beranda (Selalu Aktif)',
  tabAbsen: 'Submit Presensi',
  tabLog: 'History Presensi',
  tabInputAktivitas: 'Produktivitas Harian',
  tabAktivitas: 'History Produktivitas',
  tabReview: 'Review Produktivitas',
  tabIzin: 'Izin/Cuti',
  tabPengajuanIzin: 'Pengajuan Izin / Cuti',
  tabLogPresensiInstansi: 'History Presensi Instansi',
  tabDatabase: 'Database Pegawai',
  tabUnor: 'Struktur Organisasi',
  tabReport: 'Laporan',
  tabAutomasi: 'Preset Automasi',
  tabLogPresensiTerkini: 'Presensi Terkini',
  tabLogLengkap: 'Log Lengkap',
  reportPerPegawai: 'Laporan Presensi per Pegawai',
  reportPerPegawaiAktivitas: 'Laporan Aktivitas per Pegawai',
  reportSkorPerInstansi: 'Skor Produktivitas per Instansi',
  reportAktivitasPerInstansi: 'Aktivitas per Instansi',
  reportRekapTppAktivitas: 'Rekap TPP Aktivitas',
  allowSearchPegawai: 'Cari & Pilih Pegawai Lain (Presensi/Aktivitas)',
  allowSearchDatabase: 'Cari Pegawai di Database',
  allowSearchUnor: 'Cari Lokasi & Struktur Organisasi',
  allowSearchPresensi: 'Cari Nama Pegawai di History Presensi',
  allowSearchProduktivitas: 'Cari Nama Pegawai di History Produktivitas',
  allowSearchReview: 'Cari Nama Pegawai di Review Produktivitas',
  allowSearchIzin: 'Cari Nama Pegawai di History Izin',
  allowSearchLaporan: 'Cari Pegawai & Instansi di Menu Laporan',
  allowSearchInstansi: 'Cari Nama & Ganti Instansi di Presensi Instansi',
  allowEditLoginCredentials: 'Edit NIP & Password (Beranda)',
};

const BASE_PERMISSION_GROUPS: { label: string; keys: (keyof TabPermissions)[] }[] = [
  { label: 'Menu Utama', keys: ['tabBeranda','tabAbsen','tabLog','tabInputAktivitas','tabAktivitas','tabReview','tabIzin','tabAutomasi','tabLogPresensiInstansi','tabDatabase','tabUnor','tabReport'] },
  { label: 'Sub-fitur: History Presensi', keys: ['tabLogPresensiTerkini', 'tabLogLengkap'] },
  { label: 'Sub-fitur: Izin/Cuti', keys: ['tabPengajuanIzin'] },
  { label: 'Sub-fitur: Laporan', keys: ['reportPerPegawai','reportPerPegawaiAktivitas','reportSkorPerInstansi','reportAktivitasPerInstansi','reportRekapTppAktivitas'] },
  { label: 'Pengaturan Pencarian & Akses Data', keys: ['allowSearchPegawai','allowSearchDatabase','allowSearchUnor','allowSearchPresensi','allowSearchProduktivitas','allowSearchReview','allowSearchIzin','allowSearchInstansi','allowSearchLaporan'] },
  { label: 'Pengaturan Beranda', keys: ['allowEditLoginCredentials'] },
];

export const PERMISSION_GROUPS: { label: string; keys: (keyof TabPermissions)[] }[] = AUTOMATION_AVAILABLE
  ? BASE_PERMISSION_GROUPS
  : BASE_PERMISSION_GROUPS
      .map(g => ({ ...g, keys: g.keys.filter(k => k !== 'tabAutomasi') }))
      .filter(g => g.keys.length > 0);

export function validateUsername(username: string): string {
  const u = username.toLowerCase().trim();
  if (!u) throw new Error('Username tidak boleh kosong.');
  if (u.length < 2 || u.length > 32) throw new Error('Username harus 2–32 karakter.');
  if (!USERNAME_REGEX.test(u)) throw new Error('Username hanya boleh huruf kecil, angka, _ . -');
  if (u === 'admin') throw new Error('Username "admin" direservasi untuk administrator.');
  return u;
}

export function validatePassword(password: string, label = 'Password'): void {
  if (!password || password.length < 4) throw new Error(`${label} minimal 4 karakter.`);
  if (password.length > 128) throw new Error(`${label} terlalu panjang (maks 128 karakter).`);
}

export function sanitizeString(val: string, maxLen = 256): string {
  if (!val || typeof val !== 'string') return '';
  return val.replace(/[<>"'`\\;]/g, '').trim().substring(0, maxLen);
}

function isBrowser() { return typeof window !== 'undefined'; }

function readUsers(): UserAccount[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function writeUsers(users: UserAccount[]) {
  if (!isBrowser()) return;
  try { localStorage.setItem(USERS_KEY, JSON.stringify(users)); } catch {}
}

async function sha256Hex(input: string): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {}
  // fallback (non-crypto) - deterministic
  let h = 0; for (let i = 0; i < input.length; i++) h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  return `f${(h >>> 0).toString(16)}`;
}

export async function hashPassword(password: string): Promise<string> {
  // salted local hash
  const salt = 'presensi-local-v1';
  return `sha256$${await sha256Hex(`${salt}:${password}`)}`;
}

async function verifyHash(password: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  if (stored.startsWith('sha256$')) {
    return (await hashPassword(password)) === stored;
  }
  // legacy/plain compat (if any) - compare direct
  return stored === password;
}

function toSafe(u: UserAccount): UserAccountSafe {
  const { passwordHash: _ph, ...safe } = u;
  return { ...safe, permissions: normalizeUserPermissions(safe.permissions as any) } as UserAccountSafe;
}

export async function fetchAllUsers(): Promise<UserAccountSafe[]> {
  const users = readUsers().filter(u => u.role === 'user');
  return users.map(toSafe).sort((a, b) => a.username.localeCompare(b.username));
}

export async function findUserByUsername(username: string): Promise<UserAccount | null> {
  const normalized = username.toLowerCase().trim();
  return readUsers().find(u => u.username === normalized) || null;
}

export async function verifyUserPassword(username: string, password: string): Promise<UserAccountSafe | null> {
  const sanitizedUser = username.toLowerCase().trim().substring(0, 32);
  const sanitizedPass = password.substring(0, 128);
  const user = await findUserByUsername(sanitizedUser);
  if (!user) {
    await sha256Hex(sanitizedPass); // timing-ish padding
    return null;
  }
  const valid = await verifyHash(sanitizedPass, user.passwordHash);
  if (!valid) return null;
  return toSafe(user);
}

export async function createUserAccount(
  username: string,
  password: string,
  _displayName: string,
  permissions: TabPermissions
): Promise<UserAccountSafe> {
  const normalizedUsername = validateUsername(username);
  validatePassword(password);
  const users = readUsers();
  if (users.some(u => u.username === normalizedUsername)) {
    throw new Error(`Username "${normalizedUsername}" sudah dipakai.`);
  }
  const now = Date.now();
  const account: UserAccount = {
    id: `user_${now}_${Math.random().toString(36).slice(2, 9)}`,
    username: normalizedUsername,
    passwordHash: await hashPassword(password),
    role: 'user',
    displayName: normalizedUsername,
    permissions: normalizeUserPermissions(permissions as any),
    createdAt: now,
    updatedAt: now,
  };
  users.push(account);
  writeUsers(users);
  return toSafe(account);
}

export async function updateUserAccount(
  id: string,
  updates: { displayName?: string; password?: string; permissions?: TabPermissions; username?: string }
): Promise<void> {
  const users = readUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx < 0) throw new Error('Akun tidak ditemukan.');
  const current = users[idx];
  const patch: Partial<UserAccount> = { updatedAt: Date.now() };

  if (updates.username !== undefined) {
    const normalized = validateUsername(updates.username);
    if (normalized !== current.username && users.some(u => u.username === normalized)) {
      throw new Error(`Username "${normalized}" sudah dipakai.`);
    }
    patch.username = normalized;
    patch.displayName = normalized;
  }
  if (updates.displayName !== undefined) patch.displayName = sanitizeString(updates.displayName, 64);
  if (updates.permissions !== undefined) patch.permissions = normalizeUserPermissions(updates.permissions as any);
  if (updates.password && updates.password.length > 0) {
    validatePassword(updates.password, 'Password baru');
    patch.passwordHash = await hashPassword(updates.password);
  }
  users[idx] = { ...current, ...patch };
  writeUsers(users);
}

export async function deleteUserAccount(id: string): Promise<void> {
  if (!id || typeof id !== 'string') throw new Error('ID tidak valid.');
  const users = readUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx < 0) throw new Error('Akun tidak ditemukan.');
  if (users[idx].role !== 'user') throw new Error('Tidak dapat menghapus akun administrator.');
  users.splice(idx, 1);
  writeUsers(users);
}
