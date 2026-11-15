// @ts-nocheck
import { allowedTarget, resolveEpBase, setCors, DEFAULT_EP_BASE } from './_lib/common.js';

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');
  try {
    const q = req.query || {};
    let raw = String(q.url || q.path || '').trim();
    const useBaseUrl = String(q.use_base_url || q.useBaseUrl || '') === 'true';
    if (!raw) return res.status(400).send('path/url diperlukan');
    if (raw.startsWith('data:')) return res.status(400).send('data URL tidak didukung');
    // Normalisasi: beberapa pemanggil mengirim "/http(s)://..." sebagai path
    if (raw.startsWith('/http://') || raw.startsWith('/https://')) raw = raw.slice(1);

    const PONOROGO_IMG = 'http://103.109.206.102:8087';
    const PONOROGO_WEB = 'https://presensi.ponorogo.go.id';
    const epBase = resolveEpBase(req.headers || {}, q);
    const JATIM_EP = (process.env.VITE_JATIM_EP_BASE_URL || DEFAULT_EP_BASE || 'https://presensi.bkd.jatimprov.go.id').replace(/\/$/, '');
    const MADIUN_EP = (process.env.VITE_MADIUN_EP_BASE_URL || 'https://presensimadiun.appdev.web.id').replace(/\/$/, '');

    const tryFetchImage = async (url: string) => {
      const upstream = await fetch(url, { headers: { 'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } });
      const buf = Buffer.from(await upstream.arrayBuffer());
      const ct = upstream.headers.get('content-type') || 'application/octet-stream';
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
      } catch { candidates = [raw]; }
    } else {
      const cleanPath = raw.startsWith('/') ? raw : `/${raw}`;
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
        res.status(status).setHeader('Content-Type', ct).setHeader('Cache-Control', 'public, max-age=3600');
        return res.send(buf);
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Gagal memuat gambar');
  } catch (e: any) {
    return res.status(502).send(`Gagal memuat gambar: ${e?.message || e}`);
  }
}