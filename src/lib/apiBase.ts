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

async function probeTauriLocalBase(): Promise<string> {
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

  tauriBaseResolved = true; // stop re-probing loops; keep default
  return tauriApiBase;
}

export async function ensureTauriApiBase(): Promise<string> {
  if (!isTauriRuntime()) return '';
  if (tauriBaseResolved) return tauriApiBase;
  if (!tauriBaseResolvePromise) tauriBaseResolvePromise = probeTauriLocalBase().finally(() => { tauriBaseResolvePromise = null; });
  return tauriBaseResolvePromise;
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
