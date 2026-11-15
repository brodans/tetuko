function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as Record<string, unknown>;
  return Boolean(win.__TAURI__ || win.__TAURI_INTERNALS__ || win.__TAURI_METADATA__);
}

const LOCAL_PORT_START = Number(import.meta.env?.VITE_LOCAL_API_PORT || 14200) || 14200;
const LOCAL_PORT_END = LOCAL_PORT_START + 5;

let tauriApiBase = `http://127.0.0.1:${LOCAL_PORT_START}`;
let tauriBaseResolved = false;
let tauriBaseResolvePromise: Promise<string> | null = null;

async function probeTauriLocalBase(force = false): Promise<string> {
  if (!force && tauriBaseResolved) return tauriApiBase;
  const ports: number[] = [];
  for (let p = LOCAL_PORT_START; p <= LOCAL_PORT_END; p++) ports.push(p);

  for (const p of ports) {
    const base = `http://127.0.0.1:${p}`;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1200);
      const res = await fetch(`${base}/api/health`, { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(t);
      if (!res.ok) continue;
      const data = await res.json().catch(() => null);
      if (data && (data.app === 'tetuko' || data.ok === true)) {
        tauriApiBase = base;
        tauriBaseResolved = true;
        return base;
      }
    } catch {
      // try next port
    }
  }

  tauriBaseResolved = true; // prevent tight loops; callers can force re-probe on failure
  return tauriApiBase;
}

export async function ensureTauriApiBase(force = false): Promise<string> {
  if (!isTauriRuntime()) return '';
  if (!force && tauriBaseResolved) return tauriApiBase;
  if (!tauriBaseResolvePromise) tauriBaseResolvePromise = probeTauriLocalBase(force).finally(() => { tauriBaseResolvePromise = null; });
  return tauriBaseResolvePromise;
}

export function getTauriApiBase(): string {
  return tauriApiBase;
}

export function rebaseTauriApiUrlToCurrent(url: string): string {
  if (!isTauriRuntime()) return url;
  try {
    const u = new URL(url);
    const isLocal = (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
    if (isLocal && port >= LOCAL_PORT_START && port <= LOCAL_PORT_END) {
      return `${tauriApiBase}${u.pathname}${u.search}${u.hash}`;
    }
  } catch {
    // ignore
  }
  return url;
}

if (isTauriRuntime()) {
  // Resolve ASAP so subsequent requests (captcha/image/api) can use the active local proxy port.
  void ensureTauriApiBase();
}

export function apiUrl(path: string): string {
  const configured = import.meta.env?.VITE_API_BASE_URL?.trim();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  // Di runtime Tauri Linux, gunakan server proxy lokal bawaan jika tidak dikonfigurasi.
  if (!configured) {
    if (isTauriRuntime()) return `${tauriApiBase}${normalizedPath}`;
    return normalizedPath;
  }

  const base = /^[a-z][a-z\d+.-]*:\/\//i.test(configured)
    ? configured
    : `http://${configured}`;
  return `${base.replace(/\/$/, '')}${normalizedPath}`;
}

/**
 * Fetch ke API/proxy lokal dengan retry probe port Tauri saat koneksi gagal.
 * Membantu kasus startup race atau proxy lokal pindah ke port fallback (14201-14205).
 */
export async function tauriResilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const toUrlString = (v: RequestInfo | URL): string => {
    if (typeof v === 'string') return v;
    if (v instanceof URL) return v.toString();
    try { return (v as Request).url; } catch { return String(v); }
  };

  if (isTauriRuntime()) {
    try {
      await ensureTauriApiBase();
    } catch {
      // lanjut coba fetch, akan di-retry bila gagal
    }
  }

  const tryFetch = async (target: RequestInfo | URL) => await fetch(target, init);

  try {
    // Jika input string URL lokal Tauri, gunakan apiUrl hasil probe terbaru.
    if (typeof input === 'string') {
      return await tryFetch(rebaseTauriApiUrlToCurrent(input));
    }
    return await tryFetch(input);
  } catch (e) {
    if (!isTauriRuntime()) throw e;
    try {
      await ensureTauriApiBase(true);
      if (typeof input === 'string') {
        return await tryFetch(rebaseTauriApiUrlToCurrent(input));
      }
      const rebased = rebaseTauriApiUrlToCurrent(toUrlString(input));
      if (input instanceof Request) {
        return await tryFetch(new Request(rebased, input));
      }
      return await tryFetch(rebased);
    } catch {
      throw e;
    }
  }
}
