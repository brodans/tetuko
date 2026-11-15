import type { PegawaiProfile } from '../context/AppContext';
import { getServerProfile, type ServerProfileId } from './serverProfiles';
import type { UserAccountSafe, TabPermissions, UserRole } from './userManager';
import { DEFAULT_ADMIN_PERMISSIONS } from './userManager';
import { clearAllServerLoginCaches } from './cacheManager';
import { appStorage } from './appStorage';
import { db } from './firebase';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { encryptPayload } from './encryption';

// ─────────────────────────────────────────────────────────────────────────────
// BKD unified session (profile-based, localStorage)
// ─────────────────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'presensi_local_session_v1';

export interface StoredSession {
  profile: PegawaiProfile;
  profileId: ServerProfileId;
  savedAt: number;
  nip?: string;
}

function isBrowser(): boolean { return typeof window !== 'undefined'; }

export function loadSession(): StoredSession | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (!parsed?.profile || typeof parsed.profile !== 'object' || !parsed?.profileId) return null;
    // Pastikan profileId valid/terdaftar; tetap izinkan sesi walau apiKey kosong (mis. Ponorogo)
    getServerProfile(parsed.profileId);
    const profile = parsed.profile as any;
    const hasIdentity = Boolean(
      profile?.apiKey || profile?.api_key || profile?.token || profile?.nip || profile?.id || profile?.pegawai_id || profile?.nama
    );
    if (!hasIdentity) return null;
    return parsed as StoredSession;
  } catch { return null; }
}

export function saveSession(profile: PegawaiProfile, profileId: ServerProfileId, nip?: string): void {
  if (!isBrowser()) return;
  try {
    const data: StoredSession = { profile, profileId, savedAt: Date.now(), nip };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    // Mirror ke Firestore (non-blocking) agar login/sesi tersimpan terpusat
    try {
      const key = `session_${profileId}`;
      const encrypted = encryptPayload({ ...data, profile: data.profile });
      void setDoc(doc(db, 'settings', key), { encrypted, updatedAt: new Date().toISOString() }, { merge: true }).catch(() => {});
    } catch {}
  } catch { /* ignore */ }
}

export function clearAllSessions(): void {
  if (!isBrowser()) return;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  try {
    // clear sessionStorage caches
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith('presensi_session_cache_')) keysToRemove.push(k);
    }
    keysToRemove.forEach(k => sessionStorage.removeItem(k));
  } catch {}
  // Hapus mirror sesi di Firestore (best effort)
  for (const pid of ['jatim', 'madiun', 'ponorogo'] as const) {
    try { void deleteDoc(doc(db, 'settings', `session_${pid}`)).catch(() => {}); } catch {}
  }
}

export function tokenAktif(): string {
  try {
    const s = loadSession();
    return String((s?.profile as any)?.apiKey || '');
  } catch { return ''; }
}

export function touchSession(): void { /* no-op for BKD */ }
export function perbaruiTokenSesi(): boolean { return false; }

// ─────────────────────────────────────────────────────────────────────────────
// Ponorogo app session (role-based, per-tab/persisted) - unified in same file
// ─────────────────────────────────────────────────────────────────────────────
const PONOROGO_SESSION_KEY: Record<UserRole, string> = {
  admin: 'ponorogo_session_admin',
  user: 'ponorogo_session_user',
};

const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);

const getPonorogoSessionStorage = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> =>
  isTauriRuntime() ? appStorage : window.sessionStorage;

export const PONOROGO_SESSION_TIMEOUT_MS = 10 * 60 * 1000;

export interface PonorogoStoredSession {
  currentUser: UserAccountSafe | null;
  tabPermissions: TabPermissions;
  authTime: number;
  boundRole: UserRole;
}

export function createPonorogoAdminUserAccount(username = 'admin'): UserAccountSafe {
  return {
    id: 'admin',
    username: username.toLowerCase().trim() || 'admin',
    displayName: 'Administrator',
    role: 'admin',
    permissions: DEFAULT_ADMIN_PERMISSIONS,
    createdAt: 0,
    updatedAt: 0,
  };
}

export function savePonorogoSession(user: UserAccountSafe | null, permissions: TabPermissions): void {
  try {
    if (typeof window === 'undefined') return;
    const boundRole: UserRole = user?.role === 'user' ? 'user' : 'admin';
    const session: PonorogoStoredSession = { currentUser: user, tabPermissions: permissions, authTime: Date.now(), boundRole };
    const storage = getPonorogoSessionStorage();
    const otherRole: UserRole = boundRole === 'admin' ? 'user' : 'admin';
    storage.removeItem(PONOROGO_SESSION_KEY[otherRole]);
    const legacyStorage = isTauriRuntime() ? window.sessionStorage : appStorage;
    legacyStorage.removeItem(PONOROGO_SESSION_KEY.admin);
    legacyStorage.removeItem(PONOROGO_SESSION_KEY.user);
    storage.setItem(PONOROGO_SESSION_KEY[boundRole], JSON.stringify(session));
  } catch (err) { console.warn('[sessionManager] Gagal menyimpan session Ponorogo:', err); }
}

export function loadPonorogoSession(): PonorogoStoredSession | null {
  try {
    if (typeof window === 'undefined') return null;
    const storage = getPonorogoSessionStorage();
    let rawAdmin = storage.getItem(PONOROGO_SESSION_KEY.admin);
    let rawUser = storage.getItem(PONOROGO_SESSION_KEY.user);
    if (isTauriRuntime()) {
      const legacyAdmin = window.sessionStorage.getItem(PONOROGO_SESSION_KEY.admin);
      const legacyUser = window.sessionStorage.getItem(PONOROGO_SESSION_KEY.user);
      if ((rawAdmin && legacyUser) || (rawUser && legacyAdmin)) { clearAllPonorogoSessions(); return null; }
      if (!rawAdmin && legacyAdmin) { storage.setItem(PONOROGO_SESSION_KEY.admin, legacyAdmin); rawAdmin = legacyAdmin; }
      if (!rawUser && legacyUser) { storage.setItem(PONOROGO_SESSION_KEY.user, legacyUser); rawUser = legacyUser; }
      window.sessionStorage.removeItem(PONOROGO_SESSION_KEY.admin);
      window.sessionStorage.removeItem(PONOROGO_SESSION_KEY.user);
    }
    if (rawAdmin && rawUser) { clearAllPonorogoSessions(); return null; }
    const raw = rawAdmin || rawUser;
    const detectedRole: UserRole = rawAdmin ? 'admin' : 'user';
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PonorogoStoredSession;
    if (!parsed || !parsed.boundRole || !parsed.authTime) { clearAllPonorogoSessions(); return null; }
    if (parsed.boundRole !== detectedRole) { clearAllPonorogoSessions(); return null; }
    if (parsed.currentUser && parsed.currentUser.role !== parsed.boundRole) { clearAllPonorogoSessions(); return null; }
    if (!isTauriRuntime() && Date.now() - parsed.authTime > PONOROGO_SESSION_TIMEOUT_MS) { clearAllPonorogoSessions(); return null; }
    return parsed;
  } catch { clearAllPonorogoSessions(); return null; }
}

export function touchPonorogoSession(): void {
  try {
    if (typeof window === 'undefined' || isTauriRuntime()) return;
    const current = loadPonorogoSession();
    if (!current) return;
    const updated: PonorogoStoredSession = { ...current, authTime: Date.now() };
    getPonorogoSessionStorage().setItem(PONOROGO_SESSION_KEY[current.boundRole], JSON.stringify(updated));
  } catch (err) { console.warn('[sessionManager] Gagal touch session Ponorogo:', err); }
}

export function clearPonorogoAuthSessions(): void {
  try {
    if (typeof window === 'undefined') return;
    for (const storage of [window.sessionStorage, appStorage]) {
      storage.removeItem(PONOROGO_SESSION_KEY.admin);
      storage.removeItem(PONOROGO_SESSION_KEY.user);
      storage.removeItem('ponorogo_auth');
      storage.removeItem('ponorogo_auth_time');
    }
  } catch (err) { console.warn('[sessionManager] Gagal hapus sesi autentikasi Ponorogo:', err); }
}

export function clearAllPonorogoSessions(): void {
  clearPonorogoAuthSessions();
  try { clearAllServerLoginCaches(); } catch (err) { console.warn('[sessionManager] Gagal hapus cache login server Ponorogo:', err); }
}

export function clearPonorogoSessionByRole(role: UserRole): void {
  try {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem(PONOROGO_SESSION_KEY[role]);
    appStorage.removeItem(PONOROGO_SESSION_KEY[role]);
  } catch { /* ignore */ }
}
