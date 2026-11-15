import React from 'react';
import ReactDOM from 'react-dom/client';
import './lib/devTraffic'; // pasang instrumentasi fetch global sedini mungkin agar semua request tercatat
import App from './App';
import './index.css';

// Recovery: clear session and show login screen
try {
  const url = new URL(window.location.href);
  if (url.searchParams.get('reset') === '1' || window.location.hash === '#reset' || window.location.hash === '#logout') {
    try { localStorage.removeItem('presensi_local_session_v1'); } catch {}
    try { localStorage.removeItem('presensi_local_admin_auth_v1'); } catch {}
    try { localStorage.removeItem('presensi_server_creds_v1'); } catch {}
    try { sessionStorage.clear(); } catch {}
    try {
      // clear ponorogo/app caches keys but keep theme/preferences
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k) keys.push(k); }
      keys
        .filter(k =>
          k.startsWith('ponorogo_session') ||
          k.startsWith('presensi_session_cache_') ||
          k.startsWith('presensi_server_keluar_')
        )
        .forEach(k => { try { localStorage.removeItem(k); } catch {} });
    } catch {}
    // clean url and continue to login
    url.searchParams.delete('reset');
    url.hash = '';
    window.history.replaceState({}, '', url.toString());
  }
} catch {}

// Expose manual reset helper
(window as any).__resetPresensiApp = () => {
  try { localStorage.removeItem('presensi_local_session_v1'); } catch {}
  try { localStorage.removeItem('presensi_local_admin_auth_v1'); } catch {}
  try { localStorage.removeItem('presensi_server_creds_v1'); } catch {}
  try { sessionStorage.clear(); } catch {}
  try { window.location.href = window.location.origin + window.location.pathname + '?reset=1'; } catch { window.location.reload(); }
};

if (typeof window !== 'undefined') {
  const isBenign = (message: string) =>
    message.includes('WebSocket') ||
    message.includes('websocket') ||
    message.includes('vite') ||
    message.includes('HMR');

  window.addEventListener('unhandledrejection', event => {
    const reason = (event as any).reason?.message || String((event as any).reason || '');
    if (isBenign(reason)) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  window.addEventListener('error', event => {
    if (isBenign(event.message || '')) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
