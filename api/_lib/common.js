const PRESENSI_VERSION = 89;

export const DEFAULT_GATEWAY = process.env.VITE_JATIM_GATEWAY_URL || process.env.PRESENSI_DEFAULT_GATEWAY_URL || 'https://presensi.bkd.jatimprov.go.id/service';
export const DEFAULT_EP_BASE = process.env.VITE_JATIM_EP_BASE_URL || process.env.PRESENSI_DEFAULT_EP_BASE_URL || 'https://presensi.bkd.jatimprov.go.id';
export const PONOROGO_API_BASE = process.env.VITE_PONOROGO_API_BASE || process.env.PRESENSI_PONOROGO_API_BASE || 'http://103.109.206.102:8089/Ponorogo-absensApi/index.php';

const DEFAULT_ALLOWED = 'presensi.bkd.jatimprov.go.id,absen.madiunkab.go.id,presensimadiun.appdev.web.id,presensi.ponorogo.go.id,103.109.206.102';
export const ALLOWED_HOSTS = (process.env.PRESENSI_ALLOWED_HOSTS || DEFAULT_ALLOWED)
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

export function hostOf(u) {
  try { return new URL(u).hostname.toLowerCase(); } catch { return null; }
}

export function allowedTarget(u, allowEp = false) {
  const h = hostOf(u);
  if (!h || !ALLOWED_HOSTS.includes(h)) return false;
  if (allowEp) return true;
  return u.includes('/service') || u.includes('absensApi');
}

export function resolveGateway(headers, param) {
  const h = headers && headers['x-presensi-gateway'];
  if (typeof h === 'string' && allowedTarget(h, false)) return h;
  const p = param && param.gateway_url;
  if (typeof p === 'string' && allowedTarget(p, false)) return p;
  return DEFAULT_GATEWAY;
}

export function resolveEpBase(headers, query) {
  const h = headers && headers['x-presensi-ep-base'];
  if (typeof h === 'string' && allowedTarget(h, true)) return h.replace(/\/$/, '');
  const q = query && typeof query.ep_base === 'string' ? query.ep_base : '';
  if (q && allowedTarget(q, true)) return q.replace(/\/$/, '');
  return String(DEFAULT_EP_BASE || '').replace(/\/$/, '');
}

export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With, x-presensi-gateway, x-presensi-ep-base');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (Buffer.isBuffer(req.body)) {
    try { return JSON.parse(req.body.toString('utf8') || '{}'); } catch { return {}; }
  }
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

export async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.body && typeof req.body === 'object') {
    try { return Buffer.from(JSON.stringify(req.body)); } catch { /* fallthrough */ }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function sendJson(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(body));
}

export { PRESENSI_VERSION };
