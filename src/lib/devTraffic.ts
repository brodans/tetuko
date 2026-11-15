export interface ApiTrafficEntry {
  id: number;
  endpoint: string;
  payload: Record<string, any>;
  response?: any;
  error?: string;
  status?: number;
  duration: number;
  timestamp: string;
  method?: string;
  url?: string;
}

type ApiTrafficListener = (entry: ApiTrafficEntry) => void;

const trafficListeners = new Set<ApiTrafficListener>();
let trafficSequence = 0;

export const subscribeToApiTraffic = (listener: ApiTrafficListener) => {
  trafficListeners.add(listener);
  return () => trafficListeners.delete(listener);
};

export const publishApiTraffic = (entry: Omit<ApiTrafficEntry, 'id'>) => {
  const completeEntry = { ...entry, id: ++trafficSequence };
  trafficListeners.forEach((listener) => {
    try {
      listener(completeEntry);
    } catch {
      // ignore listener errors
    }
  });
};

function safeTextPreview(text: string, max = 4000) {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n...[truncated ${text.length - max} chars]`;
}

function tryParseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function shortUrl(input: string): string {
  try {
    const u = new URL(input, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    return u.origin === (typeof window !== 'undefined' ? window.location.origin : '') ? (u.pathname + u.search) : u.toString();
  } catch {
    return input;
  }
}

function parseBodyForLabel(url: string, method: string, body: any): { endpoint: string; payload: Record<string, any> } {
  const u = shortUrl(url);
  const upper = (method || 'GET').toUpperCase();
  let payload: Record<string, any> = {};

  if (typeof body === 'string') {
    const parsed = tryParseJson(body);
    if (parsed && typeof parsed === 'object') payload = parsed;
    else if (body) payload = { raw: safeTextPreview(body, 1000) };
  } else if (body instanceof URLSearchParams) {
    payload = Object.fromEntries(body.entries());
  } else if (body instanceof FormData) {
    const obj: Record<string, any> = {};
    body.forEach((v, k) => {
      if (obj[k] === undefined) obj[k] = typeof v === 'string' ? v : `[File:${(v as File).name || 'blob'}]`;
    });
    payload = obj;
  } else if (body && typeof body === 'object' && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !(body instanceof Uint8Array)) {
    // RequestInit body can be ReadableStream etc; ignore those
    try { payload = { ...(body as any) }; } catch { payload = {}; }
  }

  // Smart labels for common internal endpoints
  try {
    const parsedUrl = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    const path = parsedUrl.pathname;
    if (path.endsWith('/api/rpc') && payload && typeof payload.object === 'string') {
      return { endpoint: `RPC ${payload.object}`, payload };
    }
    if (path.endsWith('/api/proxy') && typeof payload.endpoint === 'string') {
      return { endpoint: `PROXY ${payload.endpoint}`, payload };
    }
    if (path.endsWith('/api/proxy-multipart') && typeof payload.endpoint === 'string') {
      return { endpoint: `UPLOAD ${payload.endpoint}`, payload };
    }
    if (path.endsWith('/api/upload')) {
      return { endpoint: `${upper} ${u}`, payload: payload && Object.keys(payload).length ? payload : { note: 'multipart/form-data' } };
    }
    if (path.endsWith('/api/ocr')) {
      return { endpoint: `${upper} ${path}`, payload: payload && Object.keys(payload).length ? payload : { note: 'image/binary body' } };
    }
    if (path.includes('/ep/')) {
      return { endpoint: `${upper} ${u}`, payload };
    }
  } catch {}

  return { endpoint: `${upper} ${u}`, payload };
}

let fetchInstrumented = false;

export function installGlobalFetchInstrumentation() {
  if (fetchInstrumented) return;
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  fetchInstrumented = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Avoid instrumenting non-http/internal weird cases
    let url = '';
    let method = (init?.method || 'GET').toUpperCase();
    try {
      if (typeof input === 'string') url = input;
      else if (input instanceof URL) url = input.toString();
      else if (input instanceof Request) { url = input.url; if (!init?.method) method = (input.method || 'GET').toUpperCase(); }
      else url = String(input);
    } catch { url = String(input); }

    // Skip data/blob/internal schemes to reduce noise
    if (/^(data:|blob:)/i.test(url)) {
      return originalFetch(input as any, init);
    }

    const startedAt = performance.now();
    const requestTimestamp = new Date().toISOString();

    let requestBody: any = init?.body;
    if (!requestBody && input instanceof Request) {
      // can't safely read Request body without consuming it; keep minimal info
      requestBody = undefined;
    }

    const { endpoint, payload } = parseBodyForLabel(url, method, requestBody);

    try {
      const response = await originalFetch(input as any, init);
      const cloned = response.clone();
      let responseData: any = undefined;
      let errorText: string | undefined;

      try {
        const ct = (cloned.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('application/json') || ct.includes('+json') || ct.includes('text/json')) {
          responseData = await cloned.json();
        } else if (ct.includes('text/') || ct.includes('application/x-www-form-urlencoded') || ct.includes('xml')) {
          const text = await cloned.text();
          responseData = { text: safeTextPreview(text, 3000) };
        } else if (ct.includes('image/') || ct.includes('application/pdf') || ct.includes('octet-stream')) {
          responseData = { binary: true, contentType: ct, size: cloned.headers.get('content-length') || undefined };
        } else {
          // best effort small text
          const text = await cloned.text();
          if (text) responseData = { text: safeTextPreview(text, 1500) };
        }
      } catch {
        // ignore parse failures
      }

      if (!response.ok) {
        if (responseData && typeof responseData === 'object') {
          errorText = (responseData.error || responseData.message || responseData.detail || `HTTP ${response.status}`);
          if (typeof errorText !== 'string') errorText = JSON.stringify(errorText);
        } else {
          errorText = `HTTP ${response.status}`;
        }
      }

      publishApiTraffic({
        endpoint,
        payload,
        response: responseData,
        error: !response.ok ? String(errorText || `HTTP ${response.status}`) : undefined,
        status: response.status,
        duration: Math.round(performance.now() - startedAt),
        timestamp: requestTimestamp,
        method,
        url: shortUrl(url),
      });

      return response;
    } catch (err: any) {
      const message = typeof err === 'string' ? err : (err?.message || 'Koneksi gagal');
      publishApiTraffic({
        endpoint,
        payload,
        error: message,
        duration: Math.round(performance.now() - startedAt),
        timestamp: requestTimestamp,
        method,
        url: shortUrl(url),
      });
      throw err;
    }
  };
}

let resourceObserverInstalled = false;

function installResourceObserver() {
  if (resourceObserverInstalled) return;
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;
  resourceObserverInstalled = true;

  try {
    const seen = new Set<string>();
    const observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceResourceTiming[]) {
        try {
          const url = e.name || '';
          if (!url || /^(data:|blob:)/i.test(url)) continue;
          // Avoid flooding with HMR/dev websocket noise
          if (url.includes('/@vite') || url.includes('/__vite') || url.startsWith('ws:') || url.startsWith('wss:')) continue;
          // fetch/xhr sudah dicatat oleh wrapper fetch (lebih detail), hindari duplikat
          if (e.initiatorType === 'fetch' || e.initiatorType === 'xmlhttprequest') continue;

          const key = `${Math.round(e.startTime)}|${url}|${e.responseStatus || 0}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (seen.size > 2000) {
            // simple cap/reset
            seen.clear();
          }

          const status = (e as any).responseStatus || 0;
          const isError = status >= 400;
          publishApiTraffic({
            endpoint: `${(e.initiatorType || 'resource').toUpperCase()} ${shortUrl(url)}`,
            payload: { initiator: e.initiatorType, transferSize: e.transferSize, encodedBodySize: e.encodedBodySize },
            response: isError ? undefined : { durationMs: Math.round(e.duration), transferSize: e.transferSize },
            error: isError ? `HTTP ${status}` : undefined,
            status: status || undefined,
            duration: Math.max(0, Math.round(e.duration || 0)),
            timestamp: new Date(Date.now() - Math.max(0, performance.now() - e.startTime)).toISOString(),
            method: (e.initiatorType || 'resource').toUpperCase(),
            url: shortUrl(url),
          });
        } catch {
          // ignore
        }
      }
    });

    observer.observe({ type: 'resource', buffered: true } as any);
  } catch {
    // ignore
  }
}

// Auto-install on import in browser
installGlobalFetchInstrumentation();
installResourceObserver();
