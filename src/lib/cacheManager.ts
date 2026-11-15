// Unified cache manager (BKD server-session cache + Ponorogo server-login cache)

// ── BKD: server session cache ────────────────────────────────────────────────
const SESSION_CACHE_PREFIX = 'presensi_session_cache_';
const SESSION_CACHE_VERSION = 1;

export interface ServerSessionCache {
  version: number;
  apiKey: string;
  nip: string;
  pegawaiId: string;
  idLokasi: string;
  kodeInstansi: string;
  kodeUnor: string;
  nama: string;
  jabatan: string;
  instansi: string;
  departemen: string;
  group: string;
  profilePic: string;
  usingWajah: number;
  workCode: string;
  imei?: string;
  cachedAt: string;
}

function toSessionKey(username: string): string {
  const normalized = username.replace(/[^a-zA-Z0-9_]/g, '_');
  return `${SESSION_CACHE_PREFIX}${normalized}`;
}

export function setServerSessionCache(username: string, cache: Omit<ServerSessionCache, 'version' | 'cachedAt'>): void {
  try {
    const key = toSessionKey(username);
    const data: ServerSessionCache = { ...cache, version: SESSION_CACHE_VERSION, cachedAt: new Date().toISOString() };
    sessionStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.warn('[cacheManager] Gagal menyimpan cache sesi server:', err);
  }
}

export function getServerSessionCache(username: string): ServerSessionCache | null {
  try {
    const key = toSessionKey(username);
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as ServerSessionCache;
    if (!data || data.version !== SESSION_CACHE_VERSION || !data.apiKey) return null;
    return data;
  } catch { return null; }
}

export function clearServerSessionCache(username: string): void {
  try { sessionStorage.removeItem(toSessionKey(username)); } catch (err) { console.warn('[cacheManager] Gagal menghapus cache sesi server:', err); }
}

// ── Ponorogo: server login cache ─────────────────────────────────────────────
const LOGIN_CACHE_VERSION = 1;
const LOGIN_CACHE_KEY_PREFIX = 'ponorogo_servercache_';

export interface ServerLoginCachePayload {
  version: number;
  serverUsername: string;
  serverPassword: string;
  pegawai: Record<string, any>;
  config: {
    idPegawai: string;
    deviceId: string;
    latitude: string;
    longitude: string;
    idLokasi: string;
    kodeInstansi: string;
    kodeUnor: string;
  };
  savedAt: string;
}

function toLoginStorageKey(ponorogoUsername: string): string {
  const normalized = ponorogoUsername.replace(/[^a-zA-Z0-9_]/g, '_');
  return `${LOGIN_CACHE_KEY_PREFIX}${normalized}`;
}

export function setServerLoginCache(
  ponorogoUsername: string,
  payload: Omit<ServerLoginCachePayload, 'version' | 'savedAt'>
): void {
  try {
    const key = toLoginStorageKey(ponorogoUsername);
    const data: ServerLoginCachePayload = { ...payload, version: LOGIN_CACHE_VERSION, savedAt: new Date().toISOString() };
    sessionStorage.setItem(key, JSON.stringify(data));
  } catch (err) { console.warn('[cacheManager] Gagal menyimpan cache login server Ponorogo:', err); }
}

export function getServerLoginCache(ponorogoUsername: string): ServerLoginCachePayload | null {
  try {
    const key = toLoginStorageKey(ponorogoUsername);
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as ServerLoginCachePayload;
    if (!data || data.version !== LOGIN_CACHE_VERSION || !data.pegawai || !data.serverUsername) return null;
    return data;
  } catch { return null; }
}

export function updateServerLoginCacheFoto(ponorogoUsername: string, newFoto: string): void {
  try {
    const existing = getServerLoginCache(ponorogoUsername);
    if (!existing) return;
    setServerLoginCache(ponorogoUsername, { ...existing, pegawai: { ...existing.pegawai, foto: newFoto } });
  } catch (err) { console.warn('[cacheManager] Gagal update foto cache Ponorogo:', err); }
}

export function clearServerLoginCache(ponorogoUsername: string): void {
  try { sessionStorage.removeItem(toLoginStorageKey(ponorogoUsername)); } catch (err) { console.warn('[cacheManager] Gagal menghapus cache login server Ponorogo:', err); }
}

export function clearAllServerLoginCaches(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(LOGIN_CACHE_KEY_PREFIX)) keysToRemove.push(k);
    }
    keysToRemove.forEach(k => sessionStorage.removeItem(k));
  } catch (err) { console.warn('[cacheManager] Gagal menghapus semua cache login server Ponorogo:', err); }
}
