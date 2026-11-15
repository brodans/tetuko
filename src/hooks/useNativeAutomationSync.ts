import { useEffect } from 'react';
import { isTauriRuntime, syncNativeAutomation } from '../lib/nativeAutomation';
import { useAppContext } from '../context/AppContext';
import { bacaSemuaPreset as bacaUnifiedPreset } from '../lib/presetOtomatisasi';
import { bacaTitik } from '../lib/lokasiTersimpan';
import { getServerProfile } from '../lib/serverProfiles';

/**
 * Sync unified/BKD automation state for the active logged-in profile to Rust native scheduler.
 */
export function useNativeUnifiedAutomationSync(options?: {
  presets?: any[];
  schedulerEnabled?: boolean;
}) {
  const { pegawai, loginForm, serverProfileId, serverProfile, config } = useAppContext();
  const username = pegawai?.nip || loginForm.username || '';

  useEffect(() => {
    if (!isTauriRuntime() || !username) return;
    let cancelled = false;
    (async () => {
      try {
        const presets = options?.presets ?? await bacaUnifiedPreset(username, serverProfileId).catch(() => []);
        const locations = await bacaTitik(username).catch(() => []);
        const profile = getServerProfile(serverProfileId);
        const payload = {
          profiles: {
            [serverProfileId]: {
              profile_id: serverProfileId,
              mode: profile.mode,
              gateway_url: profile.gatewayUrl,
              ep_base_url: profile.epBaseUrl,
              ponorogo_api_base: profile.ponorogoApiBase || '',
              scheduler_enabled: options?.schedulerEnabled ?? true,
              username,
              bkd: {
                api_key: String((pegawai as any)?.apiKey || ''),
                imei: String((pegawai as any)?.imei || config?.imei || ''),
                last_latlong: String((pegawai as any)?.lastLatLong || config?.lastLatLong || ''),
                nip: String((pegawai as any)?.nip || username),
              },
              ponorogo: profile.mode === 'ponorogo-absensi' ? {
                config: config || {},
                pegawai: (pegawai as any) || {},
              } : undefined,
              unified_presets: presets,
              locations: locations.map((l: any) => ({ id: String(l.id), nama: String(l.nama || ''), latitude: Number(l.latitude), longitude: Number(l.longitude) })),
              // stock_photos can be heavy; include if available in unified flow later
            }
          }
        };
        if (!cancelled) await syncNativeAutomation(payload as any);
      } catch (e) {
        console.warn('[native sync unified]', e);
      }
    })();
    return () => { cancelled = true; };
  }, [pegawai, loginForm.username, serverProfileId, serverProfile, config, options?.schedulerEnabled, JSON.stringify(options?.presets || null)]);
}
