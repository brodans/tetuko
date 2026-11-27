import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 5173);
const PRESENSI_VERSION = 89;

const DEFAULT_GATEWAY = process.env.PRESENSI_DEFAULT_GATEWAY_URL || 'https://presensi.bkd.jatimprov.go.id/service';
const DEFAULT_EP_BASE = process.env.PRESENSI_DEFAULT_EP_BASE_URL || 'https://presensi.bkd.jatimprov.go.id';
const PONOROGO_API_BASE = process.env.PRESENSI_PONOROGO_API_BASE || process.env.VITE_PONOROGO_API_BASE || 'http://103.109.206.102:8089/Ponorogo-absensApi/index.php';

const ALLOWED_HOSTS = (process.env.PRESENSI_ALLOWED_HOSTS || 'presensi.bkd.jatimprov.go.id,absen.madiunkab.go.id,presensimadiun.appdev.web.id,presensi.ponorogo.go.id,103.109.206.102')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

function hostOf(u: string): string | null {
  try { return new URL(u).hostname.toLowerCase(); } catch { return null; }
}
function allowedTarget(u: string, allowEp = false): boolean {
  const h = hostOf(u);
  if (!h || !ALLOWED_HOSTS.includes(h)) return false;
  if (allowEp) return true;
  return u.includes('/service') || u.includes('absensApi');
}
function resolveGateway(req: express.Request, param: any): string {
  const h = req.headers['x-presensi-gateway'];
  if (typeof h === 'string' && allowedTarget(h, false)) return h;
  const p = param?.gateway_url;
  if (typeof p === 'string' && allowedTarget(p, false)) return p;
  return DEFAULT_GATEWAY;
}
function resolveEpBase(req: express.Request): string {
  const h = req.headers['x-presensi-ep-base'];
  if (typeof h === 'string' && allowedTarget(h, true)) return h.replace(/\/$/, '');
  const q = typeof req.query.ep_base === 'string' ? req.query.ep_base : '';
  if (q && allowedTarget(q, true)) return q.replace(/\/$/, '');
  return DEFAULT_EP_BASE.replace(/\/$/, '');
}

function sendJson(res: express.Response, status: number, body: any) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(body));
}

async function readRawBody(req: express.Request): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function start() {
  const app = express();
  app.use(cors({ origin: true, credentials: true }));

  // RPC
  app.post('/api/rpc', express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const input = req.body || {};
      const paramIn = (input.param && typeof input.param === 'object' && !Array.isArray(input.param)) ? { ...input.param } : {};
      const gateway = resolveGateway(req, paramIn);
      delete paramIn.gateway_url;
      if (paramIn.api_key == null) paramIn.api_key = '';
      if (paramIn.last_latlong == null) paramIn.last_latlong = '';
      if (paramIn.imei == null) paramIn.imei = '';
      const envelope = {
        jsonrpc: 2,
        method: 'POST',
        version: PRESENSI_VERSION,
        object: String(input.object || ''),
        param: paramIn,
      };
      const upstream = await fetch(gateway, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'Accept': 'application/json',
          'User-Agent': 'okhttp/4.12.0',
        },
        body: JSON.stringify(envelope),
      });
      const text = await upstream.text();
      let data: any;
      try { data = text ? JSON.parse(text) : null; } catch { data = { error: 'Respons gateway bukan JSON', raw: text, huluStatus: 502 }; }
      if (!upstream.ok) {
        const obj = (data && typeof data === 'object') ? { ...data } : { error: String(text || upstream.statusText) };
        if (obj.huluStatus == null) obj.huluStatus = upstream.status;
        return sendJson(res, upstream.status, obj);
      }
      return sendJson(res, 200, data);
    } catch (e: any) {
      return sendJson(res, 502, { error: `Gagal menghubungi gateway: ${e?.message || e}`, errorCode: 502, huluStatus: 502 });
    }
  });

  // Upload multipart passthrough
  app.all('/api/upload', async (req, res) => {
    try {
      const epBase = resolveEpBase(req);
      const path = typeof req.query.path === 'string' ? req.query.path : '/importfile';
      let upstreamUrl = '';
      if (path.startsWith('http')) {
        if (!allowedTarget(path, true)) return sendJson(res, 403, { error: 'Target upload tidak diizinkan' });
        upstreamUrl = path;
      } else if (path.startsWith('/')) {
        upstreamUrl = `${epBase}${path}`;
      } else {
        upstreamUrl = `${epBase}/${path}`;
      }
      const body = await readRawBody(req);
      const headers: Record<string, string> = { 'Accept': 'application/json' };
      const ct = req.headers['content-type'];
      if (typeof ct === 'string') headers['Content-Type'] = ct;
      const upstream = await fetch(upstreamUrl, { method: req.method, headers, body: body.length ? body : undefined });
      const text = await upstream.text();
      let data: any;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
      return res.status(upstream.status).type('application/json').send(JSON.stringify(data));
    } catch (e: any) {
      return sendJson(res, 502, { error: String(e?.message || e) });
    }
  });

  // Ponorogo JSON/form proxy
  app.post('/api/proxy', express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const endpoint = String(req.body?.endpoint || '');
      const payload = (req.body?.payload && typeof req.body.payload === 'object') ? req.body.payload : {};
      const clean = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
      const url = `${PONOROGO_API_BASE}${clean}`;
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(payload)) {
        if (v === null || v === undefined) continue;
        params.set(k, typeof v === 'string' ? v : JSON.stringify(v));
      }
      const upstream = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': 'Dart/3.0 (dart:io)',
          'Accept': 'application/json, text/plain, */*',
          'Authorization': 'Bearer null',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      const text = await upstream.text();
      let data: any;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
      return res.status(upstream.status).type('application/json').send(JSON.stringify(data));
    } catch (e: any) {
      return sendJson(res, 502, { error: `Gagal menghubungi server Ponorogo: ${e?.message || e}` });
    }
  });

  // Ponorogo multipart proxy
  app.post('/api/proxy-multipart', express.json({ limit: '15mb' }), async (req, res) => {
    try {
      const endpoint = String(req.body?.endpoint || '');
      const fields = (req.body?.fields && typeof req.body.fields === 'object') ? req.body.fields : {};
      const file = req.body?.file;
      const clean = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
      const url = `${PONOROGO_API_BASE}${clean}`;
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) {
        if (v === null || v === undefined) continue;
        form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
      }
      if (file?.base64) {
        const bytes = Buffer.from(String(file.base64), 'base64');
        const blob = new Blob([bytes], { type: file.mimeType || 'image/jpeg' });
        form.append('lampiran', blob, file.filename || 'lampiran.jpg');
      }
      const upstream = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': 'Dart/3.0 (dart:io)',
          'Accept': 'application/json',
        },
        body: form as any,
      });
      const text = await upstream.text();
      let data: any;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
      return res.status(upstream.status).type('application/json').send(JSON.stringify(data));
    } catch (e: any) {
      return sendJson(res, 502, { error: `Gagal kirim multipart: ${e?.message || e}` });
    }
  });

  // Absensi log proxy (Ponorogo web endpoint) - direct IP + Host header bypass (Cloudflare/domain block)
  app.get('/api/absensi-log-proxy', async (req, res) => {
    try {
      const unor = String(req.query.unor || '').trim();
      const start = String(req.query.dateStart || req.query.start || '').trim();
      const end = String(req.query.dateEnd || req.query.end || '').trim();
      const namaRaw = String(req.query.nama || '').trim();
      const nipRaw = String(req.query.nip || '').trim();
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const size = Math.min(100, Math.max(1, parseInt(String(req.query.size || '25'), 10) || 25));

      if (!unor && (!namaRaw || namaRaw === 'null') && (!nipRaw || nipRaw === 'null')) {
        return res.status(400).json({ error: 'Pilih instansi atau masukkan nama/NIP untuk melakukan pencarian.' });
      }

      const stripDanger = (v: string) => v.replace(/[^a-zA-Z0-9 ._\-]/g, '').trim();
      const unorVal = unor ? stripDanger(unor) : 'null';
      const namaVal = namaRaw && namaRaw !== 'null' ? encodeURIComponent(stripDanger(namaRaw)) : 'null';
      const nipVal = nipRaw && nipRaw !== 'null' ? encodeURIComponent(stripDanger(nipRaw)) : 'null';

      const doFetch = async (targetUrl: string, hostHeader?: string) => {
        const headers: Record<string, string> = {
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://presensi.ponorogo.go.id/',
          'Origin': 'https://presensi.ponorogo.go.id',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        };
        if (hostHeader) headers['Host'] = hostHeader;
        return await fetch(targetUrl, { headers } as any);
      };

      // Primary: direct IP + Host (bypass Cloudflare/domain block, seperti j4dum4n)
      const ipUrl = `https://103.109.206.102/api/absensi-log/unor/${unorVal}/${encodeURIComponent(start)}/${encodeURIComponent(end)}/${namaVal}/${nipVal}?page.page=${page}&page.size=${size}&page=${page}&size=${size}`;
      let upstream: Response;
      try {
        upstream = await doFetch(ipUrl, 'presensi.ponorogo.go.id');
      } catch {
        // Fallback: hostname langsung
        const hostUrl = `https://presensi.ponorogo.go.id/api/absensi-log/unor/${unorVal}/${encodeURIComponent(start)}/${encodeURIComponent(end)}/${namaVal}/${nipVal}?page.page=${page}&page.size=${size}&page=${page}&size=${size}`;
        upstream = await doFetch(hostUrl);
      }

      const text = await upstream.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (!upstream.ok) {
        return res.status(upstream.status).json(data && typeof data === 'object' ? { ...data, status: upstream.status } : { error: `Server presensi mengembalikan HTTP ${upstream.status}`, raw: text });
      }
      if (data == null) return res.status(502).json({ error: 'Respons log presensi tidak valid', raw: text });
      return res.json(data);
    } catch (e: any) {
      return res.status(502).json({ error: `Gagal memuat log presensi instansi: ${e?.message || e}` });
    }
  });

  // Proxy image (Ponorogo 8087/presensi fallback + epBase)
  app.get('/api/proxy-image', async (req, res) => {
    try {
      let raw = String(req.query.url || req.query.path || '').trim();
      const useBaseUrl = String(req.query.use_base_url || req.query.useBaseUrl || '') === 'true';
      if (!raw) return res.status(400).send('path/url diperlukan');
      if (raw.startsWith('data:')) return res.status(400).send('data URL tidak didukung');
      // Normalisasi: beberapa pemanggil mengirim "/http(s)://..." sebagai path
      if (raw.startsWith('/http://') || raw.startsWith('/https://')) raw = raw.slice(1);

      const PONOROGO_IMG = 'http://103.109.206.102:8087';
      const PONOROGO_WEB = 'https://presensi.ponorogo.go.id';
      const epBase = resolveEpBase(req);
      const JATIM_EP = (process.env.VITE_JATIM_EP_BASE_URL || process.env.PRESENSI_DEFAULT_EP_BASE_URL || 'https://presensi.bkd.jatimprov.go.id').replace(/\/$/, '');
      const MADIUN_EP = (process.env.VITE_MADIUN_EP_BASE_URL || 'https://presensimadiun.appdev.web.id').replace(/\/$/, '');

      const tryFetchImage = async (url: string) => {
        const upstream = await fetch(url, { headers: { 'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } });
        const buf = Buffer.from(await upstream.arrayBuffer());
        const ct = upstream.headers.get('content-type') || 'application/octet-stream';
        // treat non-image small error pages as failure to allow fallback
        if (!upstream.ok || (ct.includes('text/html') && buf.length < 2048)) {
          throw new Error(`bad response ${upstream.status} ${ct}`);
        }
        return { status: upstream.status, ct, buf };
      };

      let candidates: string[] = [];

      if (raw.startsWith('http://') || raw.startsWith('https://')) {
        if (!allowedTarget(raw, true)) return res.status(403).send('Target gambar tidak diizinkan');
        try {
          const u = new URL(raw);
          const p = `${u.pathname}${u.search}`;
          if (u.hostname === '103.109.206.102' && (u.port === '8087' || u.port === '8089' || !u.port)) {
            candidates = [`${PONOROGO_IMG}${p}`, `${PONOROGO_WEB}${p}`, raw];
          } else if (u.hostname === 'presensi.ponorogo.go.id') {
            candidates = [`${PONOROGO_WEB}${p}`, `${PONOROGO_IMG}${p}`, raw];
          } else {
            candidates = [raw];
          }
        } catch {
          candidates = [raw];
        }
      } else {
        const cleanPath = raw.startsWith('/') ? raw : `/${raw}`;
        // Default: coba sumber Ponorogo 8087 & web, lalu epBase/profil sebagai fallback tambahan
        const primary = useBaseUrl ? `${PONOROGO_WEB}${cleanPath}` : `${PONOROGO_IMG}${cleanPath}`;
        const fallback = useBaseUrl ? `${PONOROGO_IMG}${cleanPath}` : `${PONOROGO_WEB}${cleanPath}`;
        candidates = [primary, fallback];
        for (const base of [epBase, JATIM_EP, MADIUN_EP, PONOROGO_WEB]) {
          if (!base) continue;
          const epCandidate = `${base}${cleanPath}`;
          if (!candidates.includes(epCandidate)) candidates.push(epCandidate);
        }
      }

      let lastErr: any = null;
      for (const url of candidates) {
        try {
          const { status, ct, buf } = await tryFetchImage(url);
          return res.status(status).setHeader('Content-Type', ct).setHeader('Cache-Control', 'public, max-age=3600').send(buf);
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr || new Error('Gagal memuat gambar');
    } catch (e: any) {
      return res.status(502).send(`Gagal memuat gambar: ${e?.message || e}`);
    }
  });

  // EP reverse proxy (for web/pages/assets + set-cookie/location rewrite)
  const epHandler = async (req: express.Request, res: express.Response) => {
    try {
      const epBase = resolveEpBase(req);
      const original = req.originalUrl || req.url || '/ep/';
      let upstreamPath = original.replace(/^\/ep/, '') || '/';
      // Normalisasi path: klien memakai /p/... sebagai path aman, upstream memakai /index.php/...
      upstreamPath = upstreamPath.replace(/^\/p(\/|$)/, '/index.php$1');
      const upstreamUrl = `${epBase}${upstreamPath}`;
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (!v) continue;
        const lk = k.toLowerCase();
        if (['host','connection','content-length','origin','referer','x-presensi-ep-base','x-presensi-gateway','accept-encoding'].includes(lk)) continue;
        headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
      }
      headers['Origin'] = epBase;
      headers['Referer'] = `${epBase}/`;
      try { headers['Host'] = new URL(epBase).host; } catch {}

      let body: Buffer | undefined;
      if (!['GET', 'HEAD'].includes(req.method)) {
        body = await readRawBody(req);
      }
      let upstream = await fetch(upstreamUrl, {
        method: req.method,
        headers,
        body: body && body.length ? body : undefined,
        redirect: 'manual',
      });
      let buf = Buffer.from(await upstream.arrayBuffer());
      let respStatus = upstream.status;
      let respHeaders = upstream.headers;

      // Bypass Cloudflare challenge untuk Ponorogo: retry via direct IP + Host header
      const isCfChallenge = (status: number, hdrs: Headers, bodyBuf: Buffer) => {
        const ct = (hdrs.get('content-type') || '').toLowerCase();
        const cfMit = (hdrs.get('cf-mitigated') || '').toLowerCase();
        const prefix = bodyBuf.subarray(0, 4096).toString('utf8').toLowerCase();
        const challenged = status === 403 || status === 503 || cfMit.includes('challenge')
          || prefix.includes('just a moment') || prefix.includes('__cf_chl') || prefix.includes('cf-chl')
          || prefix.includes('challenges.cloudflare.com') || prefix.includes('enable javascript and cookies to continue');
        return challenged && (ct.includes('text/html') || prefix.includes('<!doctype html') || prefix.includes('<html'));
      };
      if (isCfChallenge(respStatus, respHeaders, buf)) {
        let epHost = '';
        try { epHost = new URL(epBase).hostname.toLowerCase(); } catch {}
        if (epHost === 'presensi.ponorogo.go.id') {
          try {
            const bypass = await new Promise<{ status: number; headers: Record<string, string | string[]>; body: Buffer }>((resolve, reject) => {
              const u = new URL(`https://103.109.206.102${upstreamPath}`);
              const opts: https.RequestOptions = {
                hostname: u.hostname,
                port: 443,
                path: u.pathname + u.search,
                method: req.method,
                rejectUnauthorized: false,
                headers: {
                  ...headers,
                  Host: 'presensi.ponorogo.go.id',
                  Origin: 'https://presensi.ponorogo.go.id',
                  Referer: 'https://presensi.ponorogo.go.id/',
                },
              };
              const r = https.request(opts, (resp2) => {
                const chunks: Buffer[] = [];
                resp2.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
                resp2.on('end', () => resolve({ status: resp2.statusCode || 502, headers: resp2.headers as any, body: Buffer.concat(chunks) }));
              });
              r.on('error', reject);
              if (body && body.length) r.write(body);
              r.end();
            });
            const fakeHeaders = new Headers();
            for (const [k, v] of Object.entries(bypass.headers || {})) {
              if (Array.isArray(v)) v.forEach((vv) => fakeHeaders.append(k, vv));
              else if (v != null) fakeHeaders.set(k, String(v));
            }
            if (!isCfChallenge(bypass.status, fakeHeaders, bypass.body)) {
              respStatus = bypass.status;
              respHeaders = fakeHeaders;
              buf = bypass.body;
            }
          } catch { /* fallback ke respons asli */ }
        }
      }

      // copy headers with rewrites
      const getSetCookie = (respHeaders as any).getSetCookie?.bind(respHeaders);
      if (typeof getSetCookie === 'function') {
        const cookies: string[] = getSetCookie() || [];
        for (const c of cookies) {
          const filtered = c
            .split(';')
            .filter((p: string) => {
              const t = p.trim().toLowerCase();
              return !t.startsWith('domain=') && !t.startsWith('path=') && t !== 'secure' && !t.startsWith('samesite=');
            })
            .join(';') + '; Path=/ep; SameSite=Lax';
          res.append('Set-Cookie', filtered);
        }
      } else {
        const sc = (respHeaders as any).get?.('set-cookie');
        if (sc) {
          const arr = Array.isArray(sc) ? sc : [sc];
          for (const c of arr) {
            const filtered = String(c).split(';').filter((p: string) => { const t = p.trim().toLowerCase(); return !t.startsWith('domain=') && !t.startsWith('path=') && t !== 'secure' && !t.startsWith('samesite='); }).join(';') + '; Path=/ep; SameSite=Lax';
            res.append('Set-Cookie', filtered);
          }
        }
      }
      respHeaders.forEach((value, key) => {
        const lk = key.toLowerCase();
        if (['content-length','connection','transfer-encoding','set-cookie','content-encoding'].includes(lk)) return;
        if (lk === 'location') {
          let loc = value;
          try {
            const u = new URL(loc, epBase);
            loc = u.pathname + u.search + u.hash;
          } catch {
            // keep as-is
          }
          if (!loc.startsWith('/')) loc = '/' + loc;
          if (!loc.startsWith('/ep/')) loc = '/ep' + (loc === '/' ? '/' : loc);
          loc = loc.replace(/\/index\.php(\/|$)/g, '/p$1');
          res.setHeader('Location', loc);
          return;
        }
        res.setHeader(key, value);
      });
      res.status(respStatus).send(buf);
    } catch (e: any) {
      res.status(502).send(`Proxy error: ${e?.message || e}`);
    }
  };
  app.use('/ep', epHandler);

  // Vite middleware (dev)
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);

  const server = http.createServer(app);
  server.listen(PORT, () => {
    console.log(`[dev] TETUKO dev server running at http://localhost:${PORT}`);
    console.log(`[dev] Local API/proxy enabled: /api/rpc /api/upload /api/proxy /api/proxy-multipart /api/proxy-image /ep`);
  });
}

start().catch((err) => {
  console.error('Failed to start dev server', err);
  process.exit(1);
});
