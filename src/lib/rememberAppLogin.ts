import { isTauriRuntime } from './nativeAutomation';
import { encryptPayload, decryptPayload } from './encryption';

const KEY = 'tetuko_remember_app_login_v1';

export interface RememberedAppLogin {
  username: string;
  password: string;
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadRememberedAppLogin(): RememberedAppLogin | null {
  if (!isTauriRuntime()) return null;
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as any;
    if (!parsed || parsed.remember !== true || !parsed.payload) return null;
    const dec = decryptPayload(String(parsed.payload)) as any;
    const username = typeof dec?.username === 'string' ? dec.username : '';
    const password = typeof dec?.password === 'string' ? dec.password : '';
    if (!username || !password) return null;
    return { username, password };
  } catch {
    return null;
  }
}

export function saveRememberedAppLogin(data: RememberedAppLogin): void {
  if (!isTauriRuntime()) return;
  try {
    const payload = encryptPayload({ username: data.username, password: data.password, t: Date.now() });
    storage()?.setItem(KEY, JSON.stringify({ remember: true, payload }));
  } catch {
    // ignore
  }
}

export function clearRememberedAppLogin(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function hasRememberedAppLogin(): boolean {
  if (!isTauriRuntime()) return false;
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as any;
    return parsed?.remember === true && !!parsed?.payload;
  } catch {
    return false;
  }
}
