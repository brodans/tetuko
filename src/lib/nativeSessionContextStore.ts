import { appStorage, initializeAppStorage } from './appStorage';
import type { ServerProfileId } from './serverProfiles';

type AnyObj = Record<string, any>;

function safePart(s: string) {
  return String(s || '').trim().replace(/[/\\.#$[\]]/g, '_').slice(0, 80) || 'x';
}

function key(profileId: string, username: string) {
  return `native_session_ctx__${safePart(profileId)}__${safePart(username)}`;
}

export async function saveNativeSessionContext(profileId: ServerProfileId | string, username: string, context: AnyObj): Promise<void> {
  try {
    await initializeAppStorage();
    const payload = {
      profileId,
      username,
      context,
      updatedAt: Date.now(),
    };
    appStorage.setItem(key(profileId, username), JSON.stringify(payload));
  } catch (e) {
    console.warn('[nativeSessionContextStore] save failed', profileId, username, e);
  }
}

export async function loadNativeSessionContext(profileId: ServerProfileId | string, username: string): Promise<AnyObj | null> {
  try {
    await initializeAppStorage();
    const raw = appStorage.getItem(key(profileId, username));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && parsed.context && typeof parsed.context === 'object') ? parsed.context : null;
  } catch {
    return null;
  }
}
