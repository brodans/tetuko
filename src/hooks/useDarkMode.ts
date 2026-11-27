import { useState, useEffect, useCallback } from 'react';

const THEME_EVENT = 'tetuko-theme-change';

function readTheme(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    try { const v = window.localStorage.getItem('theme'); if (v === 'dark' || v === 'light') return v; } catch {}
    try { const v = (window as any).__appStorage?.getItem?.('theme'); if (v === 'dark' || v === 'light') return v; } catch {}
    return null;
  } catch { return null; }
}

function writeTheme(val: 'dark' | 'light') {
  try { window.localStorage.setItem('theme', val); } catch {}
  try { (window as any).__appStorage?.setItem?.('theme', val); } catch {}
  try { (globalThis as any).appStorage?.setItem?.('theme', val); } catch {}
  try { window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: val })); } catch {}
}

function resolveIsDark(): boolean {
  if (typeof window === 'undefined') return false;
  const saved = readTheme();
  if (saved) return saved === 'dark';
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; }
}

function applyTheme(isDark: boolean) {
  if (typeof window === 'undefined') return;
  const root = window.document.documentElement;
  const val: 'dark' | 'light' = isDark ? 'dark' : 'light';
  root.style.colorScheme = val;
  try { (document.body as any).dataset.theme = val; } catch {}
  root.classList.toggle('dark', isDark);
  root.classList.toggle('light', !isDark);
  const metaThemeColor = document.getElementById('theme-color-meta') || document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) metaThemeColor.setAttribute('content', isDark ? '#0B1120' : '#F8FAFC');
  try { (window as any).AndroidTetuko?.setTheme?.(isDark); } catch {}
}

export function useDarkMode() {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => resolveIsDark());

  // Terapkan tema saat state berubah & persist (single source via localStorage + event)
  useEffect(() => {
    applyTheme(isDarkMode);
    writeTheme(isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  // Sinkronkan antar instance hook (mis. App & PonorogoApp) dan antar tab
  useEffect(() => {
    const sync = (next: boolean) => setIsDarkMode(prev => (prev === next ? prev : next));

    const onThemeEvent = (e: Event) => {
      const v = (e as CustomEvent).detail;
      if (v === 'dark' || v === 'light') sync(v === 'dark');
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'theme') {
        if (e.newValue === 'dark' || e.newValue === 'light') sync(e.newValue === 'dark');
        else sync(resolveIsDark());
      }
    };
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystem = (e: MediaQueryListEvent) => {
      if (readTheme()) return; // hormati pilihan user
      sync(e.matches);
    };

    window.addEventListener(THEME_EVENT, onThemeEvent as EventListener);
    window.addEventListener('storage', onStorage);
    mq.addEventListener?.('change', onSystem);
    return () => {
      window.removeEventListener(THEME_EVENT, onThemeEvent as EventListener);
      window.removeEventListener('storage', onStorage);
      mq.removeEventListener?.('change', onSystem);
    };
  }, []);

  const toggleDarkMode = useCallback(() => setIsDarkMode(prev => !prev), []);

  return { isDarkMode, toggleDarkMode };
}
