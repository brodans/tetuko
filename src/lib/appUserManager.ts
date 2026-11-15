import bcrypt from 'bcryptjs';
import { db } from './firebase';
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, where, deleteField
} from 'firebase/firestore';
import { decryptAppCredential, encryptAppCredential, hashPinLayered, verifyPinLayered } from './encryption';
import type { ServerProfileId } from './serverProfiles';
import { AUTOMATION_AVAILABLE } from './deployMode';

// ─── Roles & profile/menu permissions ───────────────────────────────────────
export type AppRole = 'admin' | 'user';

export type BkdMenuId = 'tabBeranda' | 'tabPresensi' | 'tabPerizinan' | 'tabLaporan' | 'tabLokasiAbsen' | 'tabPresetOtomatisasi' | 'tabWeb';
export type PonorogoMenuId = 'tabBeranda' | 'tabAbsen' | 'tabLog' | 'tabInputAktivitas' | 'tabAktivitas' | 'tabReview' | 'tabIzin' | 'tabLogPresensiInstansi' | 'tabReport' | 'tabAutomasi' | 'tabDatabase' | 'tabUnor';

const ALL_BKD_MENU_DEFS: { id: BkdMenuId; label: string }[] = [
  { id: 'tabBeranda', label: 'Beranda' },
  { id: 'tabPresensi', label: 'Presensi' },
  { id: 'tabPerizinan', label: 'Perizinan' },
  { id: 'tabLaporan', label: 'Laporan' },
  { id: 'tabLokasiAbsen', label: 'Lokasi Absen' },
  { id: 'tabPresetOtomatisasi', label: 'Preset Otomatisasi' },
  { id: 'tabWeb', label: 'Web Presensi' },
];

const ALL_PONOROGO_MENU_DEFS: { id: PonorogoMenuId; label: string }[] = [
  { id: 'tabBeranda', label: 'Beranda' },
  { id: 'tabAbsen', label: 'Submit Presensi' },
  { id: 'tabLog', label: 'History Presensi' },
  { id: 'tabInputAktivitas', label: 'Produktivitas Harian' },
  { id: 'tabAktivitas', label: 'History Produktivitas' },
  { id: 'tabReview', label: 'Review Produktivitas' },
  { id: 'tabIzin', label: 'Izin/Cuti' },
  { id: 'tabLogPresensiInstansi', label: 'History Presensi Instansi' },
  { id: 'tabReport', label: 'Laporan' },
  { id: 'tabAutomasi', label: 'Preset Automasi' },
  { id: 'tabDatabase', label: 'Database Pegawai' },
  { id: 'tabUnor', label: 'Struktur Organisasi' },
];

export const BKD_MENU_DEFS: { id: BkdMenuId; label: string }[] = AUTOMATION_AVAILABLE
  ? ALL_BKD_MENU_DEFS
  : ALL_BKD_MENU_DEFS.filter(m => m.id !== 'tabPresetOtomatisasi');

export const PONOROGO_MENU_DEFS: { id: PonorogoMenuId; label: string }[] = AUTOMATION_AVAILABLE
  ? ALL_PONOROGO_MENU_DEFS
  : ALL_PONOROGO_MENU_DEFS.filter(m => m.id !== 'tabAutomasi');

export interface ProfileAccess {
  jatim: boolean;
  madiun: boolean;
  ponorogo: boolean;
}

export interface MenuAccess {
  jatim: Record<BkdMenuId, boolean>;
  madiun: Record<BkdMenuId, boolean>;
  ponorogo: Record<PonorogoMenuId, boolean>;
}

export interface AppUserPermissions {
  profiles: ProfileAccess;
  menus: MenuAccess;
  /** Izinkan user mengubah kredensial server presensi (NIP/Password/IMEI) sendiri. Jika false: hanya pakai kredensial yang ditetapkan admin (read-only) */
  allowEditServerCreds: boolean;
}

export interface AppUserAccount {
  id: string;
  username: string; // lowercase
  passwordHash: string; // bcrypt
  role: AppRole; // always 'user' for stored accounts; admin is special
  displayName: string;
  permissions: AppUserPermissions;
  createdAt: number;
  updatedAt: number;
  passwordEncrypted?: string | null; // legacy compat
}

export type AppUserSafe = Omit<AppUserAccount, 'passwordHash' | 'passwordEncrypted'>;

const USERS_COLLECTION = 'tetuko_users';
const AUTH_DOC = 'app_auth'; // settings/app_auth
const BCRYPT_ROUNDS = 10;
const USERNAME_REGEX = /^[a-z0-9_.-]{2,32}$/;

// ─── Defaults ───────────────────────────────────────────────────────────────
function allTrueBkd(): Record<BkdMenuId, boolean> {
  return ALL_BKD_MENU_DEFS.reduce((acc, m) => { acc[m.id] = true; return acc; }, {} as Record<BkdMenuId, boolean>);
}
function allTruePonorogo(): Record<PonorogoMenuId, boolean> {
  return ALL_PONOROGO_MENU_DEFS.reduce((acc, m) => { acc[m.id] = true; return acc; }, {} as Record<PonorogoMenuId, boolean>);
}

export const DEFAULT_ADMIN_APP_PERMISSIONS: AppUserPermissions = {
  profiles: { jatim: true, madiun: true, ponorogo: true },
  menus: { jatim: allTrueBkd(), madiun: allTrueBkd(), ponorogo: allTruePonorogo() },
  allowEditServerCreds: true,
};

export const DEFAULT_USER_APP_PERMISSIONS: AppUserPermissions = {
  profiles: { jatim: false, madiun: false, ponorogo: true },
  menus: {
    jatim: { ...allTrueBkd(), tabPresetOtomatisasi: false, tabWeb: false },
    madiun: { ...allTrueBkd(), tabPresetOtomatisasi: false, tabWeb: false },
    ponorogo: { ...allTruePonorogo(), tabLogPresensiInstansi: false, tabDatabase: false, tabUnor: false, tabReport: false, tabAutomasi: false },
  },
  allowEditServerCreds: false,
};

export function normalizeAppPermissions(raw?: any): AppUserPermissions {
  const base = JSON.parse(JSON.stringify(DEFAULT_USER_APP_PERMISSIONS)) as AppUserPermissions;
  if (!raw || typeof raw !== 'object') return base;
  const p = raw.profiles || {};
  base.profiles.jatim = p.jatim === true;
  base.profiles.madiun = p.madiun === true;
  base.profiles.ponorogo = p.ponorogo !== false && (p.ponorogo === true || raw.profiles == null);
  const m = raw.menus || {};
  for (const pid of ['jatim', 'madiun'] as const) {
    const src = (m[pid] || {}) as Record<string, boolean>;
    for (const def of ALL_BKD_MENU_DEFS) {
      if (def.id === 'tabBeranda') (base.menus as any)[pid][def.id] = true;
      else if (typeof src[def.id] === 'boolean') (base.menus as any)[pid][def.id] = src[def.id];
    }
  }
  const sp = (m.ponorogo || {}) as Record<string, boolean>;
  for (const def of ALL_PONOROGO_MENU_DEFS) {
    if (def.id === 'tabBeranda') base.menus.ponorogo[def.id] = true;
    else if (typeof sp[def.id] === 'boolean') (base.menus.ponorogo as any)[def.id] = sp[def.id];
  }
  base.allowEditServerCreds = typeof raw.allowEditServerCreds === 'boolean' ? raw.allowEditServerCreds : base.allowEditServerCreds;
  // Paksa nonaktif di deployment tanpa automasi
  if (!AUTOMATION_AVAILABLE) {
    base.menus.jatim.tabPresetOtomatisasi = false as any;
    base.menus.madiun.tabPresetOtomatisasi = false as any;
    base.menus.ponorogo.tabAutomasi = false as any;
  }
  return base;
}

// ─── Validation & sanitize ──────────────────────────────────────────────────
export function validateAppUsername(username: string): string {
  const u = username.toLowerCase().trim();
  if (!u) throw new Error('Username tidak boleh kosong.');
  if (u.length < 2 || u.length > 32) throw new Error('Username harus 2–32 karakter.');
  if (!USERNAME_REGEX.test(u)) throw new Error('Username hanya boleh huruf kecil, angka, _ . -');
  if (u === 'admin') throw new Error('Username "admin" direservasi untuk administrator.');
  return u;
}
export function validateAppPassword(password: string, label = 'Password'): void {
  if (!password || password.length < 4) throw new Error(`${label} minimal 4 karakter.`);
  if (password.length > 128) throw new Error(`${label} terlalu panjang (maks 128 karakter).`);
}
export function sanitizeStr(val: string, maxLen = 256): string {
  if (!val || typeof val !== 'string') return '';
  return val.replace(/[<>"'`\\;]/g, '').trim().substring(0, maxLen);
}

// ─── Admin auth (settings/app_auth) ─────────────────────────────────────────
export interface AppAdminAuth {
  adminUsername: string;
  pinHash?: string;       // layered hash compat
  pinEncrypted?: string;  // AES compat
  passwordHash?: string;  // bcrypt (preferred)
  updatedAt: number;
}

export async function getAdminAuth(): Promise<AppAdminAuth> {
  try {
    const snap = await getDoc(doc(db, 'settings', AUTH_DOC));
    if (snap.exists()) {
      const d = snap.data() as any;
      return {
        adminUsername: String(d.adminUsername || 'admin').toLowerCase().trim() || 'admin',
        pinHash: d.pinHash,
        pinEncrypted: d.pinEncrypted,
        passwordHash: d.passwordHash,
        updatedAt: Number(d.updatedAt || 0),
      };
    }
  } catch {}
  return { adminUsername: 'admin', updatedAt: 0 };
}

export async function saveAdminAuth(patch: Partial<AppAdminAuth>): Promise<void> {
  const cur = await getAdminAuth();
  await setDoc(doc(db, 'settings', AUTH_DOC), { ...cur, ...patch, updatedAt: Date.now() }, { merge: true });
}

export async function verifyAdminCredentials(username: string, password: string): Promise<boolean> {
  const u = username.toLowerCase().trim();
  const p = password.substring(0, 128);
  const auth = await getAdminAuth();
  const unameOk = u === (auth.adminUsername || 'admin');
  if (!unameOk) return false;

  // bcrypt preferred
  if (auth.passwordHash) {
    try { if (await bcrypt.compare(p, auth.passwordHash)) return true; } catch {}
  }
  // AES encrypted compat
  if (auth.pinEncrypted) {
    try { const dec = decryptAppCredential(auth.pinEncrypted); if (dec && dec === p) return true; } catch {}
  }
  // layered hash compat
  if (auth.pinHash) {
    try { if (verifyPinLayered(p, auth.pinHash)) return true; } catch {}
  }
  return false;
}

export async function setAdminPassword(newPassword: string): Promise<void> {
  validateAppPassword(newPassword, 'Password admin');
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  const pinHash = hashPinLayered(newPassword);
  const pinEncrypted = encryptAppCredential(newPassword);
  await saveAdminAuth({ passwordHash, pinHash, pinEncrypted });
}

export async function setAdminUsername(newUsername: string, currentPassword: string): Promise<void> {
  const valid = await verifyAdminCredentials((await getAdminAuth()).adminUsername, currentPassword);
  // allow if no password set yet (first setup) but require password string non-empty check handled by caller
  const auth = await getAdminAuth();
  const hasAny = !!(auth.passwordHash || auth.pinHash || auth.pinEncrypted);
  if (hasAny && !valid) throw new Error('Password verifikasi salah.');
  const uname = newUsername.toLowerCase().trim();
  if (!/^[a-zA-Z0-9_.-]{2,32}$/.test(uname)) throw new Error('Username admin hanya boleh huruf, angka, _ . - (2-32).');
  await saveAdminAuth({ adminUsername: uname });
}

// ─── User CRUD (Firestore) ──────────────────────────────────────────────────
function toSafe(u: AppUserAccount): AppUserSafe {
  const { passwordHash: _ph, passwordEncrypted: _pe, ...safe } = u;
  return { ...safe, permissions: normalizeAppPermissions((safe as any).permissions) } as AppUserSafe;
}

export async function fetchAllAppUsers(): Promise<AppUserSafe[]> {
  const q = query(collection(db, USERS_COLLECTION), where('role', '==', 'user'));
  const snap = await getDocs(q);
  return snap.docs.map(d => toSafe(d.data() as AppUserAccount)).sort((a, b) => a.username.localeCompare(b.username));
}

export async function findAppUserByUsername(username: string): Promise<AppUserAccount | null> {
  const normalized = username.toLowerCase().trim();
  const q = query(collection(db, USERS_COLLECTION), where('username', '==', normalized));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return snap.docs[0].data() as AppUserAccount;
}

const DUMMY_HASH = '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
export async function verifyAppUserPassword(username: string, password: string): Promise<AppUserSafe | null> {
  const u = username.toLowerCase().trim().substring(0, 32);
  const p = password.substring(0, 128);
  const user = await findAppUserByUsername(u);
  if (!user) { try { await bcrypt.compare(p, DUMMY_HASH); } catch {} return null; }
  let valid = false;
  if (user.passwordHash) { try { valid = await bcrypt.compare(p, user.passwordHash); } catch {} }
  if (!valid && user.passwordEncrypted) {
    try {
      const dec = decryptAppCredential(String(user.passwordEncrypted));
      if (dec && dec === p) {
        valid = true;
        const newHash = await bcrypt.hash(p, BCRYPT_ROUNDS);
        await setDoc(doc(db, USERS_COLLECTION, user.id), { passwordHash: newHash, passwordEncrypted: null, updatedAt: Date.now() }, { merge: true });
      }
    } catch {}
  }
  if (!valid) return null;
  return toSafe(user);
}

export async function createAppUser(username: string, password: string, permissions: AppUserPermissions): Promise<AppUserSafe> {
  const normalized = validateAppUsername(username);
  validateAppPassword(password);
  const existing = await findAppUserByUsername(normalized);
  if (existing) throw new Error(`Username "${normalized}" sudah dipakai.`);
  const id = `user_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const now = Date.now();
  const account: AppUserAccount = {
    id, username: normalized, passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
    role: 'user', displayName: normalized, permissions: normalizeAppPermissions(permissions),
    createdAt: now, updatedAt: now,
  };
  await setDoc(doc(db, USERS_COLLECTION, id), account);
  return toSafe(account);
}

export async function updateAppUser(id: string, updates: { username?: string; password?: string; permissions?: AppUserPermissions }): Promise<void> {
  const ref = doc(db, USERS_COLLECTION, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Akun tidak ditemukan.');
  const current = snap.data() as AppUserAccount;
  if (current.role !== 'user') throw new Error('Tidak dapat mengubah akun non-user.');
  const patch: any = { updatedAt: Date.now() };
  if (updates.username !== undefined) {
    const normalized = validateAppUsername(updates.username);
    if (normalized !== current.username) {
      const ex = await findAppUserByUsername(normalized);
      if (ex) throw new Error(`Username "${normalized}" sudah dipakai.`);
    }
    patch.username = normalized; patch.displayName = normalized;
  }
  if (updates.permissions !== undefined) patch.permissions = normalizeAppPermissions(updates.permissions);
  if (updates.password && updates.password.length > 0) {
    validateAppPassword(updates.password, 'Password baru');
    patch.passwordHash = await bcrypt.hash(updates.password, BCRYPT_ROUNDS);
    patch.passwordEncrypted = deleteField();
  }
  await setDoc(ref, patch, { merge: true });
}

export async function deleteAppUser(id: string): Promise<void> {
  const snap = await getDoc(doc(db, USERS_COLLECTION, id));
  if (!snap.exists()) throw new Error('Akun tidak ditemukan.');
  const data = snap.data() as AppUserAccount;
  if (data.role !== 'user') throw new Error('Tidak dapat menghapus akun administrator.');
  await deleteDoc(doc(db, USERS_COLLECTION, id));
}

export function isProfileAllowed(perms: AppUserPermissions | null | undefined, profileId: ServerProfileId, role: AppRole): boolean {
  if (role === 'admin') return true;
  if (!perms) return false;
  return (perms.profiles as any)[profileId] === true;
}

export function isMenuAllowed(perms: AppUserPermissions | null | undefined, profileId: ServerProfileId, menuId: string, role: AppRole): boolean {
  if (role === 'admin') return true;
  if (!perms) return false;
  if (!isProfileAllowed(perms, profileId, role)) return false;
  const m: any = (perms.menus as any)[profileId] || {};
  if (menuId === 'tabBeranda') return true;
  return m[menuId] === true;
}
