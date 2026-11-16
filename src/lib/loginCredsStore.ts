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

function normalizeCreds(input: any): SavedServerCreds | null {
  if (!input || typeof input !== 'object') return null;
  const nip = String(input.nip || input.username || '').trim();
  const password = String(input.password || '');
  if (!nip && !password) return null;
  return { nip, password, imei: input.imei ? String(input.imei) : undefined };
}

function uniqCreds(list: SavedServerCreds[]): SavedServerCreds[] {
  const seen = new Set<string>();
  const out: SavedServerCreds[] = [];
  for (const c of list) {
    const k = (c.nip || '').trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

async function loadRawPayload(profileId: string, accountKey?: string): Promise<any | null> {
  const keys = accountKey ? [docKey(profileId, accountKey), docKey(profileId)] : [docKey(profileId)];
  for (const k of keys) {
    const ref = doc(db, 'settings', k);
    const snap = await getDoc(ref);
    if (!snap.exists()) continue;
    const raw = snap.data() as any;
    const payload = raw?.encrypted ? decryptPayload(String(raw.encrypted)) : raw;
    if (payload && typeof payload === 'object') return payload;
  }
  return null;
}

/** Primary/active creds (backward compatible). */
export async function loadServerCreds(profileId: ServerProfileId | string, accountKey?: string): Promise<SavedServerCreds | null> {
  try {
    const payload = await loadRawPayload(profileId as string, accountKey);
    if (!payload) return null;
    // New multi format: { accounts: [...], activeNip?: string }
    if (Array.isArray(payload.accounts)) {
      const accounts = uniqCreds(payload.accounts.map(normalizeCreds).filter(Boolean) as SavedServerCreds[]);
      if (accounts.length === 0) return null;
      const active = String(payload.activeNip || payload.active_nip || payload.nip || '').trim().toLowerCase();
      return accounts.find(a => a.nip.trim().toLowerCase() === active) || accounts[0];
    }
    return normalizeCreds(payload);
  } catch (e) {
    console.warn('[loginCredsStore] load failed', profileId, accountKey, e);
    return null;
  }
}

export async function loadAllServerCreds(profileId: ServerProfileId | string, accountKey?: string): Promise<SavedServerCreds[]> {
  try {
    const payload = await loadRawPayload(profileId as string, accountKey);
    if (!payload) return [];
    if (Array.isArray(payload.accounts)) {
      return uniqCreds(payload.accounts.map(normalizeCreds).filter(Boolean) as SavedServerCreds[]);
    }
    const one = normalizeCreds(payload);
    return one ? [one] : [];
  } catch (e) {
    console.warn('[loginCredsStore] loadAll failed', profileId, accountKey, e);
    return [];
  }
}

/** Save/update one account creds and make it active (multi-account aware). */
export async function saveServerCreds(profileId: ServerProfileId | string, creds: SavedServerCreds, accountKey?: string): Promise<void> {
  try {
    const existing = await loadAllServerCreds(profileId, accountKey);
    const nip = (creds.nip || '').trim();
    const next = uniqCreds([
      { nip, password: creds.password, ...(creds.imei ? { imei: creds.imei } : {}) },
      ...existing.filter(a => a.nip.trim().toLowerCase() !== nip.toLowerCase()),
    ]);
    const payload = {
      profileId,
      account: accountKey ? safeKey(accountKey.trim().toLowerCase()) : undefined,
      activeNip: nip,
      accounts: next,
      // keep legacy fields for compatibility
      nip,
      username: nip,
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

export async function setActiveServerCred(profileId: ServerProfileId | string, nip: string, accountKey?: string): Promise<void> {
  try {
    const accounts = await loadAllServerCreds(profileId, accountKey);
    if (accounts.length === 0) return;
    const active = accounts.find(a => a.nip.trim().toLowerCase() === nip.trim().toLowerCase()) || accounts[0];
    await saveServerCreds(profileId, active, accountKey);
  } catch (e) {
    console.warn('[loginCredsStore] setActive failed', profileId, accountKey, e);
  }
}

export async function deleteServerCreds(profileId: ServerProfileId | string, accountKey?: string, nip?: string): Promise<void> {
  try {
    if (!nip) {
      await deleteDoc(doc(db, 'settings', docKey(profileId, accountKey)));
      return;
    }
    const accounts = await loadAllServerCreds(profileId, accountKey);
    const next = accounts.filter(a => a.nip.trim().toLowerCase() !== nip.trim().toLowerCase());
    if (next.length === 0) {
      await deleteDoc(doc(db, 'settings', docKey(profileId, accountKey)));
      return;
    }
    await saveServerCreds(profileId, next[0], accountKey);
    // if deleted was active, saveServerCreds set next[0] active; but we need to persist remaining list properly
    const payload = {
      profileId,
      account: accountKey ? safeKey(accountKey.trim().toLowerCase()) : undefined,
      activeNip: next[0].nip,
      accounts: next,
      nip: next[0].nip,
      username: next[0].nip,
      password: next[0].password,
      ...(next[0].imei ? { imei: next[0].imei } : {}),
      timestamp: new Date().toISOString(),
    };
    const encrypted = encryptPayload(payload);
    await setDoc(doc(db, 'settings', docKey(profileId, accountKey)), { encrypted, updatedAt: new Date().toISOString() }, { merge: true });
  } catch (e) {
    console.warn('[loginCredsStore] delete failed', profileId, accountKey, e);
  }
}
