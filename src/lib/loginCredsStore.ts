import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';
import { encryptPayload, decryptPayload } from './encryption';
import type { ServerProfileId } from './serverProfiles';

export type SavedServerCreds = { nip: string; password: string; imei?: string };

function safeKey(s: string) { return (s || '').replace(/[^a-zA-Z0-9_]/g, '_') || 'default'; }

function docKey(profileId: string, accountKey?: string) {
  const p = safeKey(profileId);
  if (accountKey && accountKey.trim()) return `login_${safeKey(accountKey.trim().toLowerCase())}_${p}`;
  return `login_${p}`; // legacy/global fallback
}

export async function loadServerCreds(profileId: ServerProfileId | string, accountKey?: string): Promise<SavedServerCreds | null> {
  try {
    // coba akun-spesifik dulu, lalu fallback legacy global (migrasi kompat)
    const keys = accountKey ? [docKey(profileId, accountKey), docKey(profileId)] : [docKey(profileId)];
    for (const k of keys) {
      const ref = doc(db, 'settings', k);
      const snap = await getDoc(ref);
      if (!snap.exists()) continue;
      const raw = snap.data() as any;
      const payload = raw?.encrypted ? decryptPayload(String(raw.encrypted)) : raw;
      if (!payload || typeof payload !== 'object') continue;
      const nip = String(payload.nip || payload.username || '').trim();
      const password = String(payload.password || '');
      if (!nip && !password) continue;
      return {
        nip,
        password,
        imei: payload.imei ? String(payload.imei) : undefined,
      };
    }
    return null;
  } catch (e) {
    console.warn('[loginCredsStore] load failed', profileId, accountKey, e);
    return null;
  }
}

export async function saveServerCreds(profileId: ServerProfileId | string, creds: SavedServerCreds, accountKey?: string): Promise<void> {
  try {
    const payload = {
      profileId,
      account: accountKey ? safeKey(accountKey.trim().toLowerCase()) : undefined,
      nip: creds.nip,
      username: creds.nip,
      password: creds.password,
      ...(creds.imei ? { imei: creds.imei } : {}),
      timestamp: new Date().toISOString(),
    };
    const encrypted = encryptPayload(payload);
    await setDoc(doc(db, 'settings', docKey(profileId, accountKey)), { encrypted, updatedAt: new Date().toISOString() }, { merge: true });
  } catch (e) {
    console.warn('[loginCredsStore] save failed', profileId, accountKey, e);
  }
}

export async function deleteServerCreds(profileId: ServerProfileId | string, accountKey?: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'settings', docKey(profileId, accountKey)));
  } catch (e) {
    console.warn('[loginCredsStore] delete failed', profileId, accountKey, e);
  }
}
