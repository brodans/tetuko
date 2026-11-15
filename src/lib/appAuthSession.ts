import type { AppRole, AppUserPermissions, AppUserSafe } from './appUserManager';
import { DEFAULT_ADMIN_APP_PERMISSIONS } from './appUserManager';
import { appStorage } from './appStorage';

const isTauriRuntime = (): boolean => typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);

// Gunakan localStorage (persist across restart) agar aman/nyaman di desktop; sessionStorage per-tab di web untuk isolasi
const storage = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> =>
  typeof window === 'undefined' ? ({ getItem: () => null, setItem: () => {}, removeItem: () => {} } as any) : (isTauriRuntime() ? appStorage : window.sessionStorage);

const KEY: Record<AppRole, string> = {
  admin: 'tetuko_app_session_admin',
  user: 'tetuko_app_session_user',
};

export const APP_SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 menit idle (web/non-tauri)

export interface AppAuthSession {
  user: AppUserSafe | null; // null never for admin
  role: AppRole;
  permissions: AppUserPermissions;
  authTime: number;
}

export function createAdminAppUser(username = 'admin'): AppUserSafe {
  return {
    id: 'admin',
    username: (username || 'admin').toLowerCase().trim(),
    displayName: 'Administrator',
    role: 'admin',
    permissions: DEFAULT_ADMIN_APP_PERMISSIONS,
    createdAt: 0,
    updatedAt: 0,
  };
}

export function saveAppAuthSession(session: Omit<AppAuthSession, 'authTime'> & { authTime?: number }): void {
  if (typeof window === 'undefined') return;
  const s: AppAuthSession = { ...session, authTime: session.authTime ?? Date.now() };
  const st = storage();
  const other: AppRole = s.role === 'admin' ? 'user' : 'admin';
  st.removeItem(KEY[other]);
  // bersihkan duplikat di storage lain
  try { (isTauriRuntime() ? window.sessionStorage : appStorage).removeItem(KEY.admin); (isTauriRuntime() ? window.sessionStorage : appStorage).removeItem(KEY.user); } catch {}
  st.setItem(KEY[s.role], JSON.stringify(s));
}

export function loadAppAuthSession(): AppAuthSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const st = storage();
    let rawAdmin = st.getItem(KEY.admin);
    let rawUser = st.getItem(KEY.user);
    // migrasi dari storage lain (tauri/web switch)
    try {
      const other = isTauriRuntime() ? window.sessionStorage : appStorage;
      const la = other.getItem(KEY.admin); const lu = other.getItem(KEY.user);
      if ((rawAdmin && lu) || (rawUser && la)) { clearAppAuthSession(); return null; }
      if (!rawAdmin && la) { st.setItem(KEY.admin, la); rawAdmin = la; other.removeItem(KEY.admin); }
      if (!rawUser && lu) { st.setItem(KEY.user, lu); rawUser = lu; other.removeItem(KEY.user); }
    } catch {}

    if (rawAdmin && rawUser) { clearAppAuthSession(); return null; }
    const raw = rawAdmin || rawUser;
    const detected: AppRole = rawAdmin ? 'admin' : 'user';
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppAuthSession;
    if (!parsed || parsed.role !== detected || !parsed.authTime) { clearAppAuthSession(); return null; }
    if (parsed.user && parsed.user.role !== parsed.role) { clearAppAuthSession(); return null; }
    if (!isTauriRuntime() && Date.now() - parsed.authTime > APP_SESSION_TIMEOUT_MS) { clearAppAuthSession(); return null; }
    return parsed;
  } catch { clearAppAuthSession(); return null; }
}

export function touchAppAuthSession(): void {
  if (typeof window === 'undefined' || isTauriRuntime()) return;
  const cur = loadAppAuthSession();
  if (!cur) return;
  saveAppAuthSession({ ...cur, authTime: Date.now() });
}

export function clearAppAuthSession(): void {
  if (typeof window === 'undefined') return;
  try { for (const st of [window.sessionStorage, appStorage, window.localStorage]) { st.removeItem(KEY.admin); st.removeItem(KEY.user); } } catch {}
}
