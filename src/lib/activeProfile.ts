import { getServerProfile, PROFILE_DEFAULT, type ServerProfile, type ServerProfileId } from './serverProfiles';

function initialProfileId(): ServerProfileId {
  try {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem('presensi_local_session_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.profileId) return getServerProfile(parsed.profileId).id;
      }
    }
  } catch {}
  return PROFILE_DEFAULT;
}

let current: ServerProfile = getServerProfile(initialProfileId());

export function setActiveServerProfile(id: ServerProfileId): void {
  current = getServerProfile(id);
}

export function getActiveServerProfile(): ServerProfile {
  return current;
}

export function profileHeaders(): Record<string, string> {
  return {
    'x-presensi-gateway': current.gatewayUrl,
    'x-presensi-ep-base': current.epBaseUrl,
  };
}
