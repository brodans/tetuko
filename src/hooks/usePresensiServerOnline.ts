import { useEffect, useState } from 'react';
import { apiUrl } from '../lib/apiBase';
import { profileHeaders } from '../lib/activeProfile';

type Status = 'online' | 'offline';

function getInitial(): Status {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  return 'online';
}

/**
 * Status konektivitas ke server presensi:
 * - Offline jika browser/Tauri runtime tidak online, atau probe ke server presensi (via proxy /ep) gagal/timeout.
 * - Online jika probe mendapat respons HTTP (koneksi ke server presensi terjangkau).
 */
export function usePresensiServerOnline(pollMs = 30000): Status {
  const [status, setStatus] = useState<Status>(getInitial);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;

    const setSafe = (next: Status) => {
      if (!disposed) setStatus(next);
    };

    const probe = async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setSafe('offline');
        return;
      }

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      try {
        // Probe melalui proxy lokal /ep (diteruskan ke server presensi profil aktif).
        // Respons HTTP apa pun dari proxy lokal menandakan konektivitas app/proxy aktif.
        const res = await fetch(apiUrl('/ep/'), {
          method: 'GET',
          cache: 'no-store',
          credentials: 'include',
          signal: controller.signal,
          headers: {
            'Accept': 'text/html,application/xhtml+xml,*/*;q=0.5',
            ...profileHeaders(),
          },
        });
        if (res) {
          setSafe('online');
          return;
        }
      } catch {
        // lanjut ke fallback health check
      } finally {
        window.clearTimeout(timeout);
      }

      // Fallback: jika probe /ep gagal (mis. upstream lambat), cek proxy lokal hidup
      try {
        const ctrl2 = new AbortController();
        const t2 = window.setTimeout(() => ctrl2.abort(), 4000);
        const h = await fetch(apiUrl('/api/health'), { cache: 'no-store', signal: ctrl2.signal });
        window.clearTimeout(t2);
        if (h && h.ok) { setSafe('online'); return; }
      } catch {}

      // Gagal fetch/timeout: server presensi/proxy lokal tidak terjangkau
      if (typeof navigator !== 'undefined' && navigator.onLine === false) setSafe('offline');
      else setSafe('offline');
    };

    const onOnline = () => { void probe(); };
    const onOffline = () => setSafe('offline');

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    void probe();
    timer = window.setInterval(() => { void probe(); }, pollMs);

    return () => {
      disposed = true;
      if (timer) window.clearInterval(timer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [pollMs]);

  return status;
}
