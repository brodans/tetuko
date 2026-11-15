import type { ServerProfileId } from './serverProfiles';

export type RouteInfo =
  | { kind: 'masuk' }
  | { kind: 'login' }
  | { kind: 'app'; profileId: ServerProfileId; pageId: string };

import { AUTOMATION_AVAILABLE } from './deployMode';

export const BKD_PAGE_TO_SLUG: Record<string, string> = {
  tabBeranda: 'beranda',
  tabPresensi: 'presensi',
  tabPerizinan: 'izin',
  tabLaporan: 'laporan',
  tabLokasiAbsen: 'lokasi',
  ...(AUTOMATION_AVAILABLE ? { tabPresetOtomatisasi: 'preset' } : {}),
  tabWeb: 'web',
};
export const BKD_SLUG_TO_PAGE: Record<string, string> = Object.fromEntries(
  Object.entries(BKD_PAGE_TO_SLUG).map(([k, v]) => [v, k])
);

export const PONOROGO_PAGE_TO_SLUG: Record<string, string> = {
  tabBeranda: 'beranda',
  tabAbsen: 'presensi',
  tabLog: 'log',
  tabInputAktivitas: 'produktivitas',
  tabAktivitas: 'log-produktivitas',
  tabReview: 'review',
  tabIzin: 'izin',
  tabLogPresensiInstansi: 'instansi',
  tabReport: 'laporan',
  ...(AUTOMATION_AVAILABLE ? { tabAutomasi: 'otomasi' } : {}),
  tabDatabase: 'database',
  tabUnor: 'unor',
};
export const PONOROGO_SLUG_TO_PAGE: Record<string, string> = {
  ...Object.fromEntries(Object.entries(PONOROGO_PAGE_TO_SLUG).map(([k, v]) => [v, k])),
  'login-info': 'tabBeranda', // backward compat
  ...(AUTOMATION_AVAILABLE ? {} : { otomasi: 'tabBeranda', preset: 'tabBeranda' }),
};

export function defaultPageForProfile(_profileId: ServerProfileId, mode: string): string {
  return mode === 'ponorogo-absensi' ? 'tabBeranda' : 'tabBeranda';
}

export function pageToPath(_profileId: ServerProfileId, mode: string, pageId: string): string {
  const map = mode === 'ponorogo-absensi' ? PONOROGO_PAGE_TO_SLUG : BKD_PAGE_TO_SLUG;
  const slug = map[pageId] || (mode === 'ponorogo-absensi' ? 'presensi' : 'beranda');
  return '/' + _profileId + '/' + slug;
}

export function pathToRoute(pathname: string): RouteInfo {
  const clean = (pathname || '/').split('?')[0].split('#')[0];
  const parts = clean.split('/').filter(Boolean);
  if (parts.length === 0) return { kind: 'masuk' };
  if (parts.length === 1 && parts[0] === 'masuk') return { kind: 'masuk' };
  if (parts.length === 1 && parts[0] === 'login') return { kind: 'login' };
  if (parts.length >= 2) {
    // pageId field carries slug here; caller resolves to actual page id with profile mode
    return { kind: 'app', profileId: parts[0] as ServerProfileId, pageId: parts[1] };
  }
  // legacy/unknown -> masuk (gate)
  return { kind: 'masuk' };
}

export function slugToPageId(profileId: string, mode: string, slug: string): string {
  const map = mode === 'ponorogo-absensi' ? PONOROGO_SLUG_TO_PAGE : BKD_SLUG_TO_PAGE;
  return map[slug] || defaultPageForProfile(profileId, mode);
}

export function navigateTo(path: string, replace = false) {
  if (typeof window === 'undefined') return;
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
}
