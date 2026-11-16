/**
 * Global Preset Automation Bridge (UI <-> Native Rust backend).
 *
 * - Sinkronisasi preset/konteks aktif ke scheduler Rust (Tauri native).
 * - Mendengarkan event eksekusi/notifikasi dari Rust dan menyinkronkan log/UI.
 * - Tidak menjalankan eksekusi preset di JavaScript (backend automasi preset = Rust).
 */

import { useEffect, useState, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { useServerContext } from '../hooks/useServerContext';
import {
  bacaSemuaPreset,
  bacaSemuaStockFoto,
  tulisLog as tulisLogOtomatisasi,
  type PresetOtomatisasi,
} from '../lib/presetOtomatisasi';
import { bacaStorage, tulisStorage } from '../lib/storageAman';
import { isTauriRuntime, syncNativeAutomation, setNativeScheduler } from '../lib/nativeAutomation';
import { bacaTitik } from '../lib/lokasiTersimpan';
import { getServerProfile, SERVER_PROFILES } from '../lib/serverProfiles';
import { bacaSemuaPreset as bacaSemuaPresetLegacy, bacaSemuaStockFoto as bacaSemuaStockFotoLegacy } from '../lib/presetAutomasi';
import { AUTOMATION_AVAILABLE } from '../lib/deployMode';
import { kirimNotifikasiNative } from '../lib/notifikasi';
import { loadAppAuthSession } from '../lib/appAuthSession';
import { loadAllServerCreds } from '../lib/loginCredsStore';
import { loadNativeSessionContext } from '../lib/nativeSessionContextStore';
import { syncAllCloudToLocal } from '../lib/cloudAutomationSync';

const KUNCI_STORAGE_PENJADWAL = 'presensi_penjadwal_otomatis_aktif';

/** Helper untuk membaca status aktif penjadwal dari storage (default: true). */
export function getPenjadwalAktifStorage(): boolean {
  return bacaStorage(KUNCI_STORAGE_PENJADWAL, 'true') !== 'false';
}

/** Helper untuk menyimpan status aktif penjadwal ke storage dan menyebarkan event. */
export function setPenjadwalAktifStorage(aktif: boolean): void {
  tulisStorage(KUNCI_STORAGE_PENJADWAL, aktif ? 'true' : 'false');
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('presensi-scheduler-toggle', { detail: aktif }));
  }
}

/** Helper untuk memberitahu scheduler bahwa data preset telah diperbarui. */
export function notifyPresetUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('presensi-automasi-updated'));
  }
}

function GlobalPresetSchedulerInner() {
  const { pegawai, loginForm, serverProfileId } = useAppContext();
  const { ready } = useServerContext();

  const username = pegawai?.nip || loginForm.username || '';
  const [presets, setPresets] = useState<PresetOtomatisasi[]>([]);
  const [penjadwalAktif, setPenjadwalAktif] = useState<boolean>(() => getPenjadwalAktifStorage());

  // Muat preset dari IndexedDB
  const muatPreset = useCallback(async () => {
    if (!username) {
      setPresets([]);
      return;
    }
    try {
      const data = await bacaSemuaPreset(username, serverProfileId);
      setPresets(data);
    } catch (err) {
      console.warn('[GlobalScheduler] Gagal membaca preset dari IndexedDB:', err);
    }
  }, [username, serverProfileId]);

  // Muat preset saat username berubah.
  useEffect(() => {
    void muatPreset();
  }, [muatPreset]);

  // Dengarkan event pembaruan dari halaman PresetOtomatisasi
  useEffect(() => {
    const handleToggle = (e: Event) => {
      const customEvent = e as CustomEvent<boolean>;
      setPenjadwalAktif(customEvent.detail);
    };

    const handleUpdated = () => {
      void muatPreset();
    };

    window.addEventListener('presensi-scheduler-toggle', handleToggle);
    window.addEventListener('presensi-automasi-updated', handleUpdated);

    return () => {
      window.removeEventListener('presensi-scheduler-toggle', handleToggle);
      window.removeEventListener('presensi-automasi-updated', handleUpdated);
    };
  }, [muatPreset]);

  const tauri = isTauriRuntime();

  // Listener event automasi native (Tauri/Rust) -> fallback notifikasi & sinkronisasi log UI
  useEffect(() => {
    if (!tauri) return;
    let unsubs: Array<() => void> = [];
    let cancelled = false;

    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        if (cancelled) return;

        const u1 = await listen<any>('tetuko://automation-notify', async (ev) => {
          const p = ev?.payload || {};
          const title = String(p.title || 'TETUKO');
          const body = String(p.body || '');
          try { await kirimNotifikasiNative(title, body); } catch {}
        });
        unsubs.push(u1);

        const u2 = await listen<any>('tetuko://automation-executed', async (ev) => {
          const p = ev?.payload || {};
          try {
            if (p?.profile_id && p?.username && p?.preset_id && p?.tanggal) {
              await tulisLogOtomatisasi(String(p.username), {
                presetId: String(p.preset_id),
                tanggal: String(p.tanggal),
                eksekusiPada: Number(p.eksekusi_pada || Date.now()),
                berhasil: !!p.ok || !!p.success,
                pesan: p.message ? String(p.message) : undefined,
                lokasiDipilih: p.lokasi_dipilih ? String(p.lokasi_dipilih) : undefined,
                fotoDipilih: p.foto_dipilih ? String(p.foto_dipilih) : undefined,
              } as any, String(p.profile_id));
            }
          } catch {}
          try { window.dispatchEvent(new CustomEvent('presensi-automasi-updated')); } catch {}
          void muatPreset();
        });
        unsubs.push(u2);
      } catch (e) {
        console.warn('[GlobalPresetScheduler] gagal memasang listener automasi native', e);
      }
    })();

    return () => {
      cancelled = true;
      for (const u of unsubs) try { u(); } catch {}
    };
  }, [muatPreset, tauri]);

  useEffect(() => {
    if (!tauri) return;
    void setNativeScheduler(serverProfileId, penjadwalAktif);
  }, [tauri, serverProfileId, penjadwalAktif]);

  const syncAllToNative = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      // Tarik/push sinkronisasi cloud (Firestore) <-> lokal untuk semua akun tersimpan agar native memakai data terbaru
      try { await syncAllCloudToLocal(); } catch {}
      const appSession = loadAppAuthSession();
      const accountKey = (appSession?.user?.username || (appSession?.role === 'admin' ? 'admin' : 'user')).toLowerCase();
      const allUnifiedStock = await bacaSemuaStockFoto().catch(() => [] as any[]);
      const legacyStockAll = await bacaSemuaStockFotoLegacy().catch(() => [] as any[]);

      const buildUnifiedStock = (presetList: PresetOtomatisasi[]) => {
        const ids = new Set<string>();
        for (const p of presetList) for (const id of (p.stockFotoIds || [])) ids.add(String(id));
        if (ids.size === 0) return [];
        return (allUnifiedStock as any[])
          .filter((f: any) => ids.has(String(f.id)))
          .map((f: any) => ({ id: String(f.id), nama: String(f.nama || ''), dataUrl: String(f.dataUrl || '') }));
      };

      const profilesPayload: Record<string, any> = {};
      const activePegawaiAny = (pegawai as any) || {};

      for (const sp of SERVER_PROFILES) {
        const pid = sp.id;
        const profileMeta = getServerProfile(pid as any);
        const creds = await loadAllServerCreds(pid as any, accountKey).catch(() => [] as any[]);
        for (const cred of creds) {
          const uname = String(cred?.nip || '').trim();
          if (!uname) continue;
          const key = `${pid}::${uname}`;
          const unified = await bacaSemuaPreset(uname, pid).catch(() => [] as PresetOtomatisasi[]);
          const locations = await bacaTitik(uname, pid).catch(() => []);
          let legacy: any[] = [];
          if (profileMeta.mode === 'ponorogo-absensi') {
            legacy = await bacaSemuaPresetLegacy(uname).catch(() => []);
          }
          const isActiveCtx = !!username && uname === username && pid === serverProfileId;
          const storedCtx = isActiveCtx ? null : await loadNativeSessionContext(pid, uname).catch(() => null);
          const ctxAny = isActiveCtx ? activePegawaiAny : (storedCtx || {});
          const bkdCtx = {
            api_key: String(ctxAny.apiKey || ctxAny.api_key || (isActiveCtx ? activePegawaiAny.apiKey : '') || ''),
            imei: String(ctxAny.imei || cred?.imei || ctxAny.deviceId || ctxAny.device_id || ''),
            last_latlong: String(ctxAny.lastLatLong || ctxAny.last_latlong || (ctxAny.latitude && ctxAny.longitude ? `${ctxAny.latitude},${ctxAny.longitude}` : '') || ''),
            nip: String(ctxAny.nip || uname),
          };
          const ponorogoCtx = profileMeta.mode === 'ponorogo-absensi'
            ? {
                config: {
                  idPegawai: String(ctxAny.id || ctxAny.idPegawai || ctxAny.pegawai_id || ctxAny.id_pegawai || ''),
                  deviceId: String(ctxAny.imei || cred?.imei || ctxAny.deviceId || ctxAny.device_id || ctxAny.emei || ctxAny.sim_serial || ''),
                  latitude: String(ctxAny.latitude || ctxAny.lat || ''),
                  longitude: String(ctxAny.longitude || ctxAny.long || ctxAny.longtitude || ''),
                  idLokasi: String(ctxAny.idLokasi || ctxAny.id_lokasi || ''),
                  kodeInstansi: String(ctxAny.kodeInstansi || ctxAny.kode_instansi || ''),
                  kodeUnor: String(ctxAny.kodeUnor || ctxAny.kode_unor || ctxAny.unor || ''),
                  workMode: String(ctxAny.workMode || ctxAny.work_mode || '1'),
                  versi: String(ctxAny.versi || '2.0.0'),
                },
                pegawai: (ctxAny && Object.keys(ctxAny).length > 0) ? ctxAny : { nip: uname, imei: String(cred?.imei || ''), deviceId: String(cred?.imei || '') },
              }
            : undefined;

          profilesPayload[key] = {
            profile_id: pid,
            mode: profileMeta.mode,
            gateway_url: profileMeta.gatewayUrl,
            ep_base_url: profileMeta.epBaseUrl,
            ponorogo_api_base: (profileMeta as any).ponorogoApiBase || '',
            scheduler_enabled: penjadwalAktif,
            username: uname,
            bkd: bkdCtx,
            ponorogo: ponorogoCtx,
            unified_presets: unified,
            locations: (locations as any[]).map((l: any) => ({
              id: String(l.id), nama: String(l.nama || ''), latitude: Number(l.latitude), longitude: Number(l.longitude),
            })),
            stock_photos: profileMeta.mode === 'ponorogo-absensi'
              ? (legacyStockAll as any[]).map((f: any) => ({ id: String(f.id), nama: String(f.nama || ''), dataUrl: String(f.dataUrl || '') }))
              : buildUnifiedStock(unified),
            legacy_ponorogo_presets: legacy,
          };
        }
      }

      // keep active context as primary key too for compatibility
      if (username) {
        const profileMeta = getServerProfile(serverProfileId as any);
        profilesPayload[serverProfileId] = {
          ...(profilesPayload[`${serverProfileId}::${username}`] || {}),
          profile_id: serverProfileId,
          mode: profileMeta.mode,
          gateway_url: profileMeta.gatewayUrl,
          ep_base_url: profileMeta.epBaseUrl,
          ponorogo_api_base: (profileMeta as any).ponorogoApiBase || '',
          scheduler_enabled: penjadwalAktif,
          username,
        };
      }

      if (Object.keys(profilesPayload).length > 0) {
        await syncNativeAutomation({ profiles: profilesPayload } as any);
        await setNativeScheduler(serverProfileId, penjadwalAktif);
      }
    } catch (e) {
      console.warn('[GlobalPresetScheduler] native sync gagal', e);
    }
  }, [username, serverProfileId, penjadwalAktif, pegawai]);

  useEffect(() => {
    if (!tauri) return;
    let cancelled = false;
    void syncAllToNative();
    // sinkronisasi berkala agar perubahan lokal/konfigurasi tersalin ke native state (mandiri di background)
    const iv = setInterval(() => { if (!cancelled) void syncAllToNative(); }, 60000);
    const onUpd = () => { if (!cancelled) void syncAllToNative(); };
    window.addEventListener('presensi-automasi-updated', onUpd);
    window.addEventListener('presensi-preset-updated', onUpd);
    window.addEventListener('storage', onUpd);
    return () => {
      cancelled = true;
      clearInterval(iv);
      window.removeEventListener('presensi-automasi-updated', onUpd);
      window.removeEventListener('presensi-preset-updated', onUpd);
      window.removeEventListener('storage', onUpd);
    };
  }, [tauri, syncAllToNative, presets]);

  // Backend eksekusi automasi preset berjalan di Rust native (Tauri). Komponen ini hanya sinkronisasi UI/state.
  void ready; // menjaga dependency semantik konteks
  return null;
}

export default function GlobalPresetScheduler() {
  if (!AUTOMATION_AVAILABLE) return null;
  return <GlobalPresetSchedulerInner />;
}
