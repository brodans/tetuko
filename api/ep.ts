// @ts-nocheck
import { readRawBody, resolveEpBase, setCors } from './_lib/common.js';

export const config = { api: { bodyParser: false } };

function isHopByHop(name: string) {
  return ['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailers','transfer-encoding','upgrade','host','content-length','content-encoding'].includes(name.toLowerCase());
}

function rewriteSetCookie(cookie: string) {
  const isProd = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  let c = cookie.replace(/;\s*domain=[^;]*/gi, '').replace(/;\s*path=[^;]*/gi, '');
  c = c.replace(/;+\s*$/g, '');
  c += '; Path=/ep';
  if (isProd) {
    if (!/;\s*secure/i.test(c)) c += '; Secure';
    if (!/;\s*samesite=/i.test(c)) c += '; SameSite=Lax';
  } else {
    c = c.replace(/;\s*secure/gi, '');
  }
  return c;
}

function rewriteLocation(loc: string, epBase: string) {
  let out = loc;
  try {
    const u = new URL(loc, epBase);
    out = u.pathname + u.search + u.hash;
  } catch {
    // keep as-is
  }
  if (!out.startsWith('/')) out = '/' + out;
  if (!/^\/ep(\/|$)/.test(out)) out = '/ep' + (out === '/' ? '/' : out);
  out = out.replace(/\/index\.php(\/|$)/g, '/p$1');
  return out;
}

export default async function handler(req: any, res: any) {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    const q = req.query || {};
    const headers = req.headers || {};
    const epBase = String(resolveEpBase(headers, q) || '').replace(/\/$/, '');
    const targetOrigin = (() => { try { return new URL(epBase).origin; } catch { return epBase; } })();

    // Tentukan path upstream secara robust (kompatibel dengan rewrite vercel & panggilan langsung)
    const originalUrl = String(req.url || '/ep/');
    const rewriteSrc = String(headers['x-vercel-rewrite-source'] || headers['x-matched-path'] || '');
    const sourceUrl = rewriteSrc || originalUrl;

    let upstreamPath = sourceUrl
      .replace(/^\/api\/ep/, '')
      .replace(/^\/ep/, '');
    if (!upstreamPath.startsWith('/')) upstreamPath = '/' + upstreamPath;
    if (!upstreamPath || upstreamPath === '/api/ep') upstreamPath = '/';

    // Jika masih memakai ?__path=... (rewrite lama), hormati itu
    if ((upstreamPath === '/' || upstreamPath === '') && typeof q.__path === 'string') {
      upstreamPath = q.__path.startsWith('/') ? q.__path : '/' + q.__path;
    }

    // Pastikan query string asli (captcha r/reload, dll) ikut diteruskan
    try {
      const parsed = new URL(originalUrl, 'http://localhost');
      const qs = new URLSearchParams(parsed.search);
      qs.delete('__path');
      qs.delete('ep_base');
      const qsStr = qs.toString();
      if (qsStr) {
        if (upstreamPath.includes('?')) {
          // merge, hindari duplikasi sederhana
          const [base, existing] = upstreamPath.split('?');
          const merged = new URLSearchParams(existing || '');
          qs.forEach((v, k) => merged.append(k, v));
          upstreamPath = base + '?' + merged.toString();
        } else {
          upstreamPath += '?' + qsStr;
        }
      }
    } catch {
      // abaikan parsing query
    }

    // Normalisasi path portal: /p/... -> /index.php/...
    upstreamPath = upstreamPath.replace(/^\/p(\/|$)/, '/index.php$1');
    const upstreamUrl = `${epBase}${upstreamPath}`;

    const outHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (!v) continue;
      const lk = k.toLowerCase();
      if (isHopByHop(lk) || ['x-presensi-ep-base','x-presensi-gateway','x-forwarded-host','x-forwarded-for','accept-encoding','cookie'].includes(lk)) continue;
      if (lk === 'origin' || lk === 'referer' || lk === 'host') continue;
      outHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v);
    }
    const cookie = headers['cookie'];
    if (typeof cookie === 'string' && cookie) outHeaders['Cookie'] = cookie;
    try { outHeaders['Host'] = new URL(epBase).host; } catch {}
    outHeaders['Origin'] = targetOrigin;
    outHeaders['Referer'] = `${targetOrigin}/`;

    // Body: dukung stream mentah dan body yang sudah diparse Vercel/Node
    let body: Buffer | undefined;
    const method = String(req.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD'].includes(method)) {
      const bodyLangsung = req.body;
      const contentType = String(headers['content-type'] || '');
      if (bodyLangsung !== undefined && bodyLangsung !== null) {
        if (Buffer.isBuffer(bodyLangsung)) body = bodyLangsung;
        else if (typeof bodyLangsung === 'string') body = Buffer.from(bodyLangsung);
        else if (bodyLangsung instanceof Uint8Array) body = Buffer.from(bodyLangsung);
        else if (typeof bodyLangsung === 'object' && contentType.includes('application/x-www-form-urlencoded')) {
          const params = new URLSearchParams();
          for (const [k, v] of Object.entries(bodyLangsung)) params.append(k, String(v as any));
          body = Buffer.from(params.toString(), 'utf-8');
        } else if (typeof bodyLangsung === 'object') {
          body = Buffer.from(JSON.stringify(bodyLangsung));
        } else {
          body = await readRawBody(req);
        }
      } else {
        body = await readRawBody(req);
      }
    }

    const upstream = await fetch(upstreamUrl, {
      method,
      headers: outHeaders,
      body: body && body.length ? body : undefined,
      redirect: 'manual',
    });

    res.status(upstream.status);

    const getSetCookie = (upstream.headers as any).getSetCookie?.bind(upstream.headers);
    const rawCookies: string[] = typeof getSetCookie === 'function'
      ? (getSetCookie() || [])
      : (() => {
          const single = upstream.headers.get('set-cookie');
          return single ? [single] : [];
        })();

    const rewrittenCookies = rawCookies.map(rewriteSetCookie).filter(Boolean);

    upstream.headers.forEach((value, key) => {
      const lk = key.toLowerCase();
      if (isHopByHop(lk) || lk === 'set-cookie') return;
      if (lk === 'location') {
        res.setHeader('Location', rewriteLocation(value, epBase));
        return;
      }
      try { res.setHeader(key, value); } catch {}
    });

    if (rewrittenCookies.length) {
      try { res.setHeader('Set-Cookie', rewrittenCookies); } catch {}
    }

    if (method === 'HEAD') {
      res.end();
      return;
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (e: any) {
    try {
      res.status(502).setHeader('Content-Type', 'application/json; charset=utf-8');
      res.send(JSON.stringify({ error: 'Gagal menghubungi server Web Presensi', detail: e?.message || String(e) }));
    } catch {
      res.status(502).end(`Proxy error: ${e?.message || e}`);
    }
  }
}