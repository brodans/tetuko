import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { encryptPayload, decryptPayload } from './encryption';

type AnyRecord = Record<string, any>;

function safePart(s: string) {
  return String(s || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'x';
}

export function cloudSyncDocId(kind: string, accountKey: string, profileId: string, username: string) {
  return `${safePart(kind)}__${safePart(accountKey || 'user')}__${safePart(profileId)}__${safePart(username)}`;
}

export async function pullCloudData(kind: string, accountKey: string, profileId: string, username: string): Promise<AnyRecord | null> {
  try {
    const id = cloudSyncDocId(kind, accountKey, profileId, username);
    const snap = await getDoc(doc(db, 'cloud_sync', id));
    if (!snap.exists()) return null;
    const raw = snap.data() as any;
    const payload = raw?.encrypted ? decryptPayload(String(raw.encrypted)) : raw;
    if (!payload || typeof payload !== 'object') return null;
    return payload as AnyRecord;
  } catch (e) {
    console.warn('[cloudSync] pull failed', kind, profileId, username, e);
    return null;
  }
}

export async function pushCloudData(kind: string, accountKey: string, profileId: string, username: string, data: AnyRecord): Promise<void> {
  try {
    const id = cloudSyncDocId(kind, accountKey, profileId, username);
    const payload = {
      kind,
      accountKey: safePart(accountKey || 'user'),
      profileId,
      username,
      ...data,
      updatedAt: Date.now(),
    };
    const encrypted = encryptPayload(payload);
    await setDoc(doc(db, 'cloud_sync', id), {
      encrypted,
      kind,
      accountKey: safePart(accountKey || 'user'),
      profileId,
      username,
      updatedAt: Date.now(),
      updatedAtServer: serverTimestamp(),
    }, { merge: true });
  } catch (e) {
    console.warn('[cloudSync] push failed', kind, profileId, username, e);
  }
}
