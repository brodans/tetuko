// @ts-nocheck
import { PONOROGO_API_BASE, readJsonBody, sendJson, setCors } from './_lib/common.js';

export default async function handler(req: any, res: any) {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

    const body = await readJsonBody(req);
    const endpoint = String(body?.endpoint || '');
    const payload = (body?.payload && typeof body.payload === 'object') ? body.payload : {};
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
    return res.status(upstream.status).setHeader('Content-Type', 'application/json').send(JSON.stringify(data));
  } catch (e: any) {
    try {
      return sendJson(res, 502, { error: `Gagal menghubungi server Ponorogo: ${e?.message || e}` });
    } catch {
      res.status(502).end(`Proxy error: ${e?.message || e}`);
    }
  }
}