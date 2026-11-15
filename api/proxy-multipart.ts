// @ts-nocheck
import { PONOROGO_API_BASE, readJsonBody, sendJson, setCors } from './_lib/common.js';

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    // Endpoint ini menerima JSON (fields + file.base64) dari client, bukan multipart mentah browser.
    const body = await readJsonBody(req);
    const endpoint = String(body?.endpoint || '');
    const fields = (body?.fields && typeof body.fields === 'object') ? body.fields : {};
    const file = body?.file;
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
      headers: { 'User-Agent': 'Dart/3.0 (dart:io)', 'Accept': 'application/json' },
      body: form as any,
    });
    const text = await upstream.text();
    let data: any;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return res.status(upstream.status).setHeader('Content-Type', 'application/json').send(JSON.stringify(data));
  } catch (e: any) {
    return sendJson(res, 502, { error: `Gagal kirim multipart: ${e?.message || e}` });
  }
}