import { encryptPayload, decryptPayload } from './encryption';

export interface ServerLoginSettings {
  username: string;
  password: string;
  versi?: string;
  idPegawai?: string;
  deviceId?: string;
  latitude?: string;
  longitude?: string;
  idLokasi?: string;
  kodeInstansi?: string;
  kodeUnor?: string;
}

function storageKey(ponorogoUsername: string): string {
  const username = ponorogoUsername.trim().replace(/[^a-zA-Z0-9_]/g, '_') || 'default';
  return `ponorogo_server_login_${username}`;
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

export function getServerLoginSettingsDocumentId(ponorogoUsername: string): string {
  return storageKey(ponorogoUsername);
}

export async function fetchServerLoginSettings(
  ponorogoUsername: string,
): Promise<ServerLoginSettings | null> {
  try {
    const rawStr = localStorage.getItem(storageKey(ponorogoUsername));
    if (!rawStr) return null;
    const raw = JSON.parse(rawStr);
    const settings = typeof raw.encrypted === 'string' ? decryptPayload(raw.encrypted) : raw;
    if (
      typeof settings.username !== 'string' || !settings.username ||
      typeof settings.password !== 'string' || !settings.password
    ) return null;
    return {
      username: settings.username,
      password: settings.password,
      versi: asOptionalString(settings.versi),
      idPegawai: asOptionalString(settings.idPegawai),
      deviceId: asOptionalString(settings.deviceId),
      latitude: asOptionalString(settings.latitude),
      longitude: asOptionalString(settings.longitude),
      idLokasi: asOptionalString(settings.idLokasi),
      kodeInstansi: asOptionalString(settings.kodeInstansi),
      kodeUnor: asOptionalString(settings.kodeUnor),
    };
  } catch {
    return null;
  }
}

export async function saveServerLoginSettings(
  ponorogoUsername: string,
  settings: ServerLoginSettings,
): Promise<void> {
  const encrypted = encryptPayload(settings as any);
  localStorage.setItem(storageKey(ponorogoUsername), JSON.stringify({ encrypted }));
}
