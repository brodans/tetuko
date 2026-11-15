// @ts-nocheck
import { readJsonBody, resolveGateway, sendJson, setCors, PRESENSI_VERSION } from './_lib/common.js';

export default async function handler(req: any, res: any) {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

    const input = await readJsonBody(req);
    const paramIn = (input?.param && typeof input.param === 'object' && !Array.isArray(input.param)) ? { ...input.param } : {};
    const gateway = resolveGateway(req.headers || {}, paramIn);
    delete paramIn.gateway_url;
    if (paramIn.api_key == null) paramIn.api_key = '';
    if (paramIn.last_latlong == null) paramIn.last_latlong = '';
    if (paramIn.imei == null) paramIn.imei = '';
    const envelope = {
      jsonrpc: 2,
      method: 'POST',
      version: PRESENSI_VERSION,
      object: String(input?.object || ''),
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
    try {
      return sendJson(res, 502, { error: `Gagal menghubungi gateway: ${e?.message || e}`, errorCode: 502, huluStatus: 502 });
    } catch {
      res.status(502).end(`Proxy error: ${e?.message || e}`);
    }
  }
}