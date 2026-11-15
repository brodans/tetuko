// @ts-nocheck
import { allowedTarget, readRawBody, resolveEpBase, sendJson, setCors } from './_lib/common.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const q = req.query || {};
    const epBase = resolveEpBase(req.headers || {}, q);
    const path = typeof q.path === 'string' ? q.path : '/importfile';
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
    const ct = req.headers?.['content-type'];
    if (typeof ct === 'string') headers['Content-Type'] = ct;
    const upstream = await fetch(upstreamUrl, { method: req.method, headers, body: body.length ? body : undefined });
    const text = await upstream.text();
    let data: any;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return res.status(upstream.status).setHeader('Content-Type', 'application/json').send(JSON.stringify(data));
  } catch (e: any) {
    return sendJson(res, 502, { error: String(e?.message || e) });
  }
}