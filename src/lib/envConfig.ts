export type AttendanceMode = 'bkd-rpc' | 'ponorogo-absensi';

function env(key: string, fallback = ''): string {
  const v = (import.meta as any).env?.[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback;
}
function envBool(key: string, fallback: boolean): boolean {
  const v = env(key, '');
  if (!v) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export const APP_NAME = 'TETUKO';

export interface ServerProfileConfig {
  id: string;
  nama: string;
  label: string;
  gatewayUrl: string;
  epBaseUrl: string;
  mode: AttendanceMode;
  requiresPhotoPreset: boolean;
  requiresWorkCode: boolean;
  ponorogoApiBase?: string;
  ponorogoImageBase?: string;
}

export const SERVER_PROFILES: ServerProfileConfig[] = [
  {
    id: env('VITE_JATIM_ID', 'jatim'),
    nama: env('VITE_JATIM_NAME', 'Provinsi Jawa Timur'),
    label: env('VITE_JATIM_LABEL', 'Presensi Jatimprov'),
    gatewayUrl: env('VITE_JATIM_GATEWAY_URL'),
    epBaseUrl: env('VITE_JATIM_EP_BASE_URL'),
    mode: (env('VITE_JATIM_MODE', 'bkd-rpc') as AttendanceMode),
    requiresPhotoPreset: envBool('VITE_JATIM_REQUIRES_PHOTO', false),
    requiresWorkCode: envBool('VITE_JATIM_REQUIRES_WORKCODE', true),
  },
  {
    id: env('VITE_PONOROGO_ID', 'ponorogo'),
    nama: env('VITE_PONOROGO_NAME', 'Kabupaten Ponorogo'),
    label: env('VITE_PONOROGO_LABEL', 'Presensi Ponorogo'),
    gatewayUrl: env('VITE_PONOROGO_GATEWAY_URL'),
    epBaseUrl: env('VITE_PONOROGO_EP_BASE_URL'),
    mode: (env('VITE_PONOROGO_MODE', 'ponorogo-absensi') as AttendanceMode),
    requiresPhotoPreset: envBool('VITE_PONOROGO_REQUIRES_PHOTO', true),
    requiresWorkCode: envBool('VITE_PONOROGO_REQUIRES_WORKCODE', false),
    ponorogoApiBase: env('VITE_PONOROGO_API_BASE'),
    ponorogoImageBase: env('VITE_PONOROGO_IMAGE_BASE'),
  },
  {
    id: env('VITE_MADIUN_ID', 'madiun'),
    nama: env('VITE_MADIUN_NAME', 'Kabupaten Madiun'),
    label: env('VITE_MADIUN_LABEL', 'Presensi Madiunkab'),
    gatewayUrl: env('VITE_MADIUN_GATEWAY_URL'),
    epBaseUrl: env('VITE_MADIUN_EP_BASE_URL'),
    mode: (env('VITE_MADIUN_MODE', 'bkd-rpc') as AttendanceMode),
    requiresPhotoPreset: envBool('VITE_MADIUN_REQUIRES_PHOTO', false),
    requiresWorkCode: envBool('VITE_MADIUN_REQUIRES_WORKCODE', true),
  },
].filter(p => p.id && p.gatewayUrl && p.epBaseUrl);

export type ServerProfileId = string;
export const PROFILE_DEFAULT: ServerProfileId = SERVER_PROFILES[0]?.id || 'jatim';

export function getServerProfile(id: string | null | undefined): ServerProfileConfig {
  return SERVER_PROFILES.find(p => p.id === id) ?? SERVER_PROFILES[0];
}

export function allowedProxyHosts(): string[] {
  const hosts = new Set<string>();
  for (const p of SERVER_PROFILES) {
    for (const u of [p.gatewayUrl, p.epBaseUrl, p.ponorogoApiBase, p.ponorogoImageBase]) {
      if (!u) continue;
      try { hosts.add(new URL(u).host.toLowerCase()); } catch {}
    }
  }
  return [...hosts];
}
