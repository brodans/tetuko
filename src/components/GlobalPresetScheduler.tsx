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
import { getServerProfile } from '../lib/serverProfiles';
import { bacaSemuaPreset as bacaSemuaPresetLegacy, bacaSemuaStockFoto as bacaSemuaStockFotoLegacy } from '../lib/presetAutomasi';
import { AUTOMATION_AVAILABLE } from '../lib/deployMode';
import { kirimNotifikasiNative } from '../lib/notifikasi';

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

  useEffect(() => {
    if (!tauri || !username) return;

    let cancelled = false;
    (async () => {
      try {
        const allUnifiedStock = await bacaSemuaStockFoto().catch(() => [] as any[]);
        const buildUnifiedStock = (presetList: PresetOtomatisasi[]) => {
          const ids = new Set<string>();
          for (const p of presetList) for (const id of (p.stockFotoIds || [])) ids.add(String(id));
          if (ids.size === 0) return [];
          return (allUnifiedStock as any[])
            .filter((f: any) => ids.has(String(f.id)))
            .map((f: any) => ({ id: String(f.id), nama: String(f.nama || ''), dataUrl: String(f.dataUrl || '') }));
        };

        // Sinkronkan hanya profil aktif (konteks akun & sesi presensi yang sedang digunakan)
        const profile = getServerProfile(serverProfileId);
        const locations = await bacaTitik(username).catch(() => []);
        const pAny = (pegawai as any) || {};
        const bkdCtx = {
          api_key: String(pAny.apiKey || pAny.api_key || ''),
          imei: String(pAny.imei || pAny.deviceId || ''),
          last_latlong: String(pAny.lastLatLong || pAny.last_latlong || (pAny.latitude && pAny.longitude ? `${pAny.latitude},${pAny.longitude}` : '') || ''),
          nip: String(pAny.nip || username),
        };
        const ponorogoCtx = profile.mode === 'ponorogo-absensi'
          ? {
              config: {
                idPegawai: String(pAny.id || pAny.idPegawai || pAny.pegawai_id || ''),
                deviceId: String(pAny.imei || pAny.deviceId || pAny.device_id || pAny.emei || ''),
                latitude: String(pAny.latitude || ''),
                longitude: String(pAny.longitude || ''),
                idLokasi: String(pAny.idLokasi || pAny.id_lokasi || ''),
                kodeInstansi: String(pAny.kodeInstansi || pAny.kode_instansi || ''),
                kodeUnor: String(pAny.kodeUnor || pAny.kode_unor || pAny.unor || ''),
                workMode: String(pAny.workMode || pAny.work_mode || '1'),
                versi: String(pAny.versi || '2.0.0'),
              },
              pegawai: pAny,
            }
          : undefined;

        let legacyPresets: any[] = [];
        let legacyStock: any[] = [];
        if (profile.mode === 'ponorogo-absensi') {
          try { legacyPresets = await bacaSemuaPresetLegacy(username); } catch { legacyPresets = []; }
          try {
            const ls = await bacaSemuaStockFotoLegacy();
            legacyStock = (ls as any[]).map(f => ({ id: String(f.id), nama: String(f.nama || ''), dataUrl: String(f.dataUrl || '') }));
          } catch { legacyStock = []; }
        }

        const profilePayload = {
          profile_id: serverProfileId,
          mode: profile.mode,
          gateway_url: profile.gatewayUrl,
          ep_base_url: profile.epBaseUrl,
          ponorogo_api_base: (profile as any).ponorogoApiBase || '',
          scheduler_enabled: penjadwalAktif,
          username,
          bkd: bkdCtx,
          ponorogo: ponorogoCtx,
          unified_presets: presets,
          locations: (locations as any[]).map((l: any) => ({
            id: String(l.id), nama: String(l.nama || ''), latitude: Number(l.latitude), longitude: Number(l.longitude),
          })),
          stock_photos: profile.mode === 'ponorogo-absensi' && legacyStock.length > 0 ? legacyStock : buildUnifiedStock(presets),
          legacy_ponorogo_presets: legacyPresets,
        };

        if (!cancelled) {
          await syncNativeAutomation({ profiles: { [serverProfileId]: profilePayload } } as any);
          await setNativeScheduler(serverProfileId, penjadwalAktif);
        }
      } catch (e) {
        console.warn('[GlobalPresetScheduler] native sync gagal', e);
      }
    })();

    return () => { cancelled = true; };
  }, [tauri, username, serverProfileId, penjadwalAktif, pegawai, presets]);

  // Backend eksekusi automasi preset berjalan di Rust native (Tauri). Komponen ini hanya sinkronisasi UI/state.
  void ready; // menjaga dependency semantik konteks
  return null;
}

export default function GlobalPresetScheduler() {
  if (!AUTOMATION_AVAILABLE) return null;
  return <GlobalPresetSchedulerInner />;
}
