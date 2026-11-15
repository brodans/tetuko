// @ts-nocheck
import https from 'https';
import { URL } from 'url';
import { sendJson, setCors } from './_lib/common.js';

function httpsGetByIp(urlStr: string, headers: Record<string, string>, hostHeader: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(urlStr);
      const req = https.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || 443,
          path: parsed.pathname + parsed.search,
          method: 'GET',
          headers: { ...headers, Host: hostHeader },
          rejectUnauthorized: false,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => resolve({ status: res.statusCode || 500, body: data }));
        }
      );
      req.on('error', reject);
      req.setTimeout(25000, () => req.destroy(new Error('Timeout')));
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

export default async function handler(req: any, res: any) {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

    const q = req.query || {};
    const unor = String(q.unor || '').trim();
    const start = String(q.dateStart || q.start || '').trim();
    const end = String(q.dateEnd || q.end || '').trim();
    const namaRaw = String(q.nama || '').trim();
    const nipRaw = String(q.nip || '').trim();
    const page = Math.max(1, parseInt(String(q.page || '1'), 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt(String(q.size || '25'), 10) || 25));

    if (!unor && (!namaRaw || namaRaw === 'null') && (!nipRaw || nipRaw === 'null')) {
      return sendJson(res, 400, { error: 'Pilih instansi atau masukkan nama/NIP untuk melakukan pencarian.' });
    }

    const stripDanger = (v: string) => v.replace(/[^a-zA-Z0-9 ._\-]/g, '').trim();
    const unorVal = unor ? stripDanger(unor) : 'null';
    const namaVal = namaRaw && namaRaw !== 'null' ? encodeURIComponent(stripDanger(namaRaw)) : 'null';
    const nipVal = nipRaw && nipRaw !== 'null' ? encodeURIComponent(stripDanger(nipRaw)) : 'null';

    // Direct IP HTTPS bypass (host header presensi.ponorogo.go.id) agar tidak diblok Cloudflare/domain pada runtime Vercel
    const targetUrl = `https://103.109.206.102/api/absensi-log/unor/${unorVal}/${encodeURIComponent(start)}/${encodeURIComponent(end)}/${namaVal}/${nipVal}?page.page=${page}&page.size=${size}&page=${page}&size=${size}`;

    const headers = {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://presensi.ponorogo.go.id/',
      'Origin': 'https://presensi.ponorogo.go.id',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    };

    const upstream = await httpsGetByIp(targetUrl, headers, 'presensi.ponorogo.go.id');
    let data: any = null;
    try { data = upstream.body ? JSON.parse(upstream.body) : null; } catch { data = null; }

    if (upstream.status !== 200) {
      return res.status(upstream.status).json(
        data && typeof data === 'object'
          ? { ...data, status: upstream.status }
          : { error: `Server presensi mengembalikan HTTP ${upstream.status}`, raw: String(upstream.body || '').slice(0, 500) }
      );
    }
    if (data == null) return sendJson(res, 502, { error: 'Respons log presensi tidak valid', raw: String(upstream.body || '').slice(0, 500) });
    return res.status(200).json(data);
  } catch (e: any) {
    if (e?.message === 'Timeout') return sendJson(res, 504, { error: 'Request ke server presensi timeout. Coba lagi.' });
    try {
      return sendJson(res, 502, { error: `Gagal memuat log presensi instansi: ${e?.message || e}` });
    } catch {
      res.status(502).end(`Proxy error: ${e?.message || e}`);
    }
  }
}