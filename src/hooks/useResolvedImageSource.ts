import { useEffect, useState } from 'react';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args as any);
}

const IMAGE_PROXY_PATH = '/api/proxy-image';
const LOCAL_PROXY_BASE = 'http://127.0.0.1:14200';
const IMAGE_SERVER_HOST = '103.109.206.102';
const IMAGE_CACHE_LIMIT = 80;
const IMAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const resolvedImageCache = new Map<string, { source: string; expiresAt: number }>();
const pendingImageRequests = new Map<string, Promise<string>>();

function toProxyImageUrl(path: string, useBaseUrl = false, absolute = false) {
  const q = new URLSearchParams({ path });
  if (useBaseUrl) q.set('use_base_url', 'true');
  const rel = `${IMAGE_PROXY_PATH}?${q.toString()}`;
  return absolute ? `${LOCAL_PROXY_BASE}${rel}` : rel;
}

function normalizeForBrowser(source: string): string {
  if (!source) return source;
  if (source.startsWith('data:') || source.startsWith('blob:')) return source;

  // If already a local/proxy-image URL, keep as-is (works in dev) or make absolute in tauri
  try {
    const url = new URL(source, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    if (url.pathname === IMAGE_PROXY_PATH) {
      if (isTauriRuntime() && !/^https?:/i.test(source)) return `${LOCAL_PROXY_BASE}${url.pathname}${url.search}`;
      return source;
    }
    const host = url.hostname.toLowerCase();
    if (host === IMAGE_SERVER_HOST && url.port === '8087') {
      return toProxyImageUrl(`${url.pathname}${url.search}`, false, isTauriRuntime());
    }
    if (host === 'presensi.ponorogo.go.id') {
      return toProxyImageUrl(`${url.pathname}${url.search}`, true, isTauriRuntime());
    }
  } catch {
    // relative/path-only
  }

  // relative asset paths that likely belong to Ponorogo (uploads/foto/etc.) -> proxy
  if (/^\/?(uploads|img|file|storage|images|assets|foto|photos|lampiran|berkas|_next|public)\b/i.test(source)) {
    const clean = source.startsWith('/') ? source : `/${source}`;
    return toProxyImageUrl(clean, false, isTauriRuntime());
  }

  return source;
}

export const resolveImageSource = async (source: string): Promise<string> => {
  if (!source || source.startsWith('data:') || source.startsWith('blob:')) {
    return source;
  }

  const tauri = isTauriRuntime();

  // In browser/dev (non-Tauri), normalize to /api/proxy-image so dev-server proxy can fetch it
  if (!tauri) {
    return normalizeForBrowser(source);
  }

  let imagePath = '';
  let useBaseUrl = false;

  try {
    const url = new URL(source, window.location.origin);

    if (url.pathname === IMAGE_PROXY_PATH) {
      imagePath = url.searchParams.get('path') || url.searchParams.get('url') || '';
      useBaseUrl = url.searchParams.get('use_base_url') === 'true' || url.searchParams.get('useBaseUrl') === 'true';
      if (/^https?:\/\//i.test(imagePath)) {
        const remoteUrl = new URL(imagePath);
        if (remoteUrl.hostname === IMAGE_SERVER_HOST && remoteUrl.port === '8087') {
          imagePath = `${remoteUrl.pathname}${remoteUrl.search}`;
          useBaseUrl = false;
        } else if (remoteUrl.hostname === 'presensi.ponorogo.go.id') {
          imagePath = `${remoteUrl.pathname}${remoteUrl.search}`;
          useBaseUrl = true;
        } else {
          // unknown remote; go through local HTTP proxy
          return toProxyImageUrl(imagePath, false, true);
        }
      }
    } else if (url.protocol === 'http:' || url.protocol === 'https:') {
      if (url.hostname === IMAGE_SERVER_HOST && url.port === '8087') {
        imagePath = `${url.pathname}${url.search}`;
        useBaseUrl = false;
      } else if (url.hostname === 'presensi.ponorogo.go.id') {
        imagePath = `${url.pathname}${url.search}`;
        useBaseUrl = true;
      } else {
        return source;
      }
    } else {
      // relative path inside tauri
      imagePath = source.startsWith('/') ? source : `/${source}`;
      useBaseUrl = false;
    }
  } catch {
    // relative/odd path
    imagePath = source.startsWith('/') ? source : `/${source}`;
    useBaseUrl = false;
  }

  if (!imagePath) return source;
  const cacheKey = `${useBaseUrl ? 'https' : 'http'}:${imagePath}`;
  const cached = resolvedImageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    resolvedImageCache.delete(cacheKey);
    resolvedImageCache.set(cacheKey, cached);
    return cached.source;
  }
  if (cached) resolvedImageCache.delete(cacheKey);

  const pendingRequest = pendingImageRequests.get(cacheKey);
  if (pendingRequest) return pendingRequest;

  const request = invokeTauri<string>('absensi_image_proxy', { path: imagePath, useBaseUrl })
    .then((resolved) => {
      if (resolved) {
        resolvedImageCache.set(cacheKey, {
          source: resolved,
          expiresAt: Date.now() + IMAGE_CACHE_TTL_MS,
        });
        if (resolvedImageCache.size > IMAGE_CACHE_LIMIT) {
          const oldestKey = resolvedImageCache.keys().next().value;
          if (oldestKey) resolvedImageCache.delete(oldestKey);
        }
        return resolved;
      }
      return toProxyImageUrl(imagePath, useBaseUrl, true);
    })
    .catch(() => {
      // fallback: try through local proxy endpoint URL (absolute in tauri)
      return toProxyImageUrl(imagePath, useBaseUrl, true);
    })
    .finally(() => pendingImageRequests.delete(cacheKey));
  pendingImageRequests.set(cacheKey, request);
  return request;
};

export const useResolvedImageSource = (source: string): string => {
  const [resolvedSource, setResolvedSource] = useState(() => normalizeForBrowser(source || ''));

  useEffect(() => {
    let active = true;
    const normalized = normalizeForBrowser(source || '');
    setResolvedSource((prev) => prev || normalized || source || '');

    resolveImageSource(source)
      .then((resolved) => {
        if (active) setResolvedSource(resolved || normalized || source);
      })
      .catch(() => {
        if (active) setResolvedSource(normalized || source);
      });

    return () => {
      active = false;
    };
  }, [source]);

  return resolvedSource;
};
