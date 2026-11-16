import { loadAllServerCreds } from './loginCredsStore';
import { loadAppAuthSession } from './appAuthSession';
import { SERVER_PROFILES } from './serverProfiles';
import { pullCloudData, pushCloudData } from './cloudSync';

// presetOtomatisasi (unified, scoped by profileId+username)
import {
  bacaSemuaPreset as bacaUnifiedPresets,
  simpanSemuaPreset as simpanUnifiedPresets,
  type PresetOtomatisasi,
} from './presetOtomatisasi';

// presetAutomasi (legacy ponorogo, scoped by username only)
import {
  bacaSemuaPreset as bacaLegacyPresets,
  simpanSemuaPreset as simpanLegacyPresets,
  type PresetAutomasi,
} from './presetAutomasi';

// lokasi (profile-aware local store + cloud)
import {
  syncLokasiFromCloud,
  pushLokasiToCloud,
} from './lokasiTersimpan';

function nowMs() { return Date.now(); }

export async function syncAllCloudToLocal(): Promise<void> {
  try {
    const appSession = loadAppAuthSession();
    const accountKey = (appSession?.user?.username || (appSession?.role === 'admin' ? 'admin' : 'user')).toLowerCase();

    for (const sp of SERVER_PROFILES) {
      const profileId = sp.id;
      const creds = await loadAllServerCreds(profileId as any, accountKey).catch(() => [] as any[]);
      for (const cred of creds) {
        const username = String((cred as any)?.nip || '').trim();
        if (!username) continue;

        // Unified presets (per profile+username)
        const cloudUnified = await pullCloudData('preset_unified', accountKey, profileId, username);
        if (cloudUnified && Array.isArray(cloudUnified.presets)) {
          const local = await bacaUnifiedPresets(username, profileId).catch(() => [] as PresetOtomatisasi[]);
          const cloudUpdated = Number(cloudUnified.updatedAt || 0);
          const localUpdated = Math.max(0, ...local.map(p => Number(p.diperbarui || 0)));
          if (cloudUpdated >= localUpdated) {
            await simpanUnifiedPresets(username, cloudUnified.presets as PresetOtomatisasi[], profileId).catch(() => {});
          } else {
            await pushCloudData('preset_unified', accountKey, profileId, username, { presets: local, updatedAt: nowMs() }).catch(() => {});
          }
        } else {
          const local = await bacaUnifiedPresets(username, profileId).catch(() => [] as PresetOtomatisasi[]);
          if (local.length > 0) await pushCloudData('preset_unified', accountKey, profileId, username, { presets: local, updatedAt: nowMs() }).catch(() => {});
        }

        // Legacy presets (Ponorogo only, stored by username in legacy store)
        if (sp.mode === 'ponorogo-absensi') {
          const cloudLegacy = await pullCloudData('preset_legacy', accountKey, profileId, username);
          if (cloudLegacy && Array.isArray(cloudLegacy.presets)) {
            const local = await bacaLegacyPresets(username).catch(() => [] as PresetAutomasi[]);
            const cloudUpdated = Number(cloudLegacy.updatedAt || 0);
            const localUpdated = Math.max(0, ...local.map(p => Number(p.diperbarui || 0)));
            if (cloudUpdated >= localUpdated) {
              await simpanLegacyPresets(username, cloudLegacy.presets as PresetAutomasi[]).catch(() => {});
            } else {
              await pushCloudData('preset_legacy', accountKey, profileId, username, { presets: local, updatedAt: nowMs() }).catch(() => {});
            }
          } else {
            const local = await bacaLegacyPresets(username).catch(() => [] as PresetAutomasi[]);
            if (local.length > 0) await pushCloudData('preset_legacy', accountKey, profileId, username, { presets: local, updatedAt: nowMs() }).catch(() => {});
          }
        }

        // Lokasi (profile-aware local store + cloud)
        try {
          const rec = await syncLokasiFromCloud(accountKey, profileId, username);
          if (rec) await pushLokasiToCloud(accountKey, profileId, username, rec);
        } catch {}
      }
    }
  } catch (e) {
    console.warn('[cloudAutomationSync] syncAllCloudToLocal failed', e);
  }
}

export async function pushAllLocalToCloud(): Promise<void> {
  try {
    const appSession = loadAppAuthSession();
    const accountKey = (appSession?.user?.username || (appSession?.role === 'admin' ? 'admin' : 'user')).toLowerCase();
    for (const sp of SERVER_PROFILES) {
      const profileId = sp.id;
      const creds = await loadAllServerCreds(profileId as any, accountKey).catch(() => [] as any[]);
      for (const cred of creds) {
        const username = String((cred as any)?.nip || '').trim();
        if (!username) continue;
        const unified = await bacaUnifiedPresets(username, profileId).catch(() => [] as PresetOtomatisasi[]);
        await pushCloudData('preset_unified', accountKey, profileId, username, { presets: unified, updatedAt: nowMs() }).catch(() => {});
        if (sp.mode === 'ponorogo-absensi') {
          const legacy = await bacaLegacyPresets(username).catch(() => [] as PresetAutomasi[]);
          await pushCloudData('preset_legacy', accountKey, profileId, username, { presets: legacy, updatedAt: nowMs() }).catch(() => {});
        }
        await pushLokasiToCloud(accountKey, profileId, username).catch(() => {});
      }
    }
  } catch (e) {
    console.warn('[cloudAutomationSync] pushAllLocalToCloud failed', e);
  }
}
