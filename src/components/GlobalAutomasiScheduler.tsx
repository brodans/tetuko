// ─────────────────────────────────────────────────────────────────────────────
// GlobalAutomasiScheduler — dipasang di level AppShell agar berjalan di semua tab.
// Tidak merender apapun. Cukup panggil useAutomasiScheduler + usePengingatProduktivitas.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { usePonorogoAppContext as useAppContext } from '../context/AppContext';
import { bacaSemuaPreset, getPenjadwalAktif, setPenjadwalAktif, HariKerja, PresetAutomasi } from '../lib/presetAutomasi';
import { useAutomasiScheduler } from '../hooks/useAutomasiScheduler';
import { usePengingatProduktivitas } from '../hooks/usePengingatProduktivitas';
import { appStorage } from '../lib/appStorage';
import { isNativeAutomationPreferred, syncNativeAutomation, setNativeScheduler } from '../lib/nativeAutomation';
import { bacaSemuaStockFoto } from '../lib/presetAutomasi';
import { bacaSemuaPreset as bacaSemuaPresetUnified, bacaSemuaStockFoto as bacaSemuaStockFotoUnified } from '../lib/presetOtomatisasi';

// ─── Kunci IndexedDB (via appStorage) ─────────────────────────────────────────
const KEY_PENGINGAT_AKTIF = 'pengingat_produktivitas_aktif';
const KEY_JAM_BATAS       = 'pengingat_jam_batas';
const KEY_HARI_AKTIF      = 'pengingat_hari_aktif';

const HARI_DEFAULT: HariKerja[] = [1, 2, 3, 4, 5]; // Senin–Jumat

// Semua getter/setter pakai appStorage (IndexedDB + in-memory, bukan localStorage)
export function getPengingatAktif(): boolean {
  return appStorage.getItem(KEY_PENGINGAT_AKTIF) !== 'false';
}
export function setPengingatAktifStorage(v: boolean): void {
  appStorage.setItem(KEY_PENGINGAT_AKTIF, v ? 'true' : 'false');
}
export function getJamBatas(): string {
  return appStorage.getItem(KEY_JAM_BATAS) ?? '08:30';
}
export function setJamBatasStorage(v: string): void {
  appStorage.setItem(KEY_JAM_BATAS, v);
}
export function getHariAktifPengingat(): HariKerja[] {
  const raw = appStorage.getItem(KEY_HARI_AKTIF);
  if (!raw) return HARI_DEFAULT;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as HariKerja[];
  } catch {/* */}
  return HARI_DEFAULT;
}
export function setHariAktifPengingatStorage(v: HariKerja[]): void {
  appStorage.setItem(KEY_HARI_AKTIF, JSON.stringify(v));
}

// ─────────────────────────────────────────────────────────────────────────────
export default function GlobalAutomasiScheduler() {
  const { pegawai, config, currentUser } = useAppContext();
  const username = currentUser?.username ?? null;

  // Baca nilai awal dari appStorage (sudah di-load ke memory saat app init)
  const [penjadwalAktif, setPenjadwalAktifState] = useState<boolean>(() => getPenjadwalAktif());
  const [pengingatAktif, setPengingatAktifState] = useState<boolean>(() => getPengingatAktif());
  const [jamBatas,       setJamBatasState]        = useState<string>(() => getJamBatas());
  const [hariAktif,      setHariAktifState]       = useState<HariKerja[]>(() => getHariAktifPengingat());
  const [presets,        setPresets]              = useState<PresetAutomasi[]>([]);
  const [ready,          setReady]                = useState(false);

  // Muat presets dari IndexedDB
  const muatPresets = async (user: string) => {
    try {
      const p = await bacaSemuaPreset(user);
      setPresets(p);
    } catch {
      setPresets([]);
    } finally {
      setReady(true);
    }
  };

  useEffect(() => {
    if (username) { setReady(false); muatPresets(username); }
    else { setPresets([]); setReady(false); }
  }, [username]);

  // Re-load saat ada perubahan preset
  useEffect(() => {
    const handler = () => { if (username) muatPresets(username); };
    window.addEventListener('presensi-preset-updated', handler);
    return () => window.removeEventListener('presensi-preset-updated', handler);
  }, [username]);

  // Listen toggle penjadwal presensi dari halaman Automasi
  useEffect(() => {
    const handler = (e: Event) => {
      const aktif = (e as CustomEvent<{ aktif: boolean }>).detail.aktif;
      setPenjadwalAktifState(aktif);
      setPenjadwalAktif(aktif); // juga persist via presetAutomasi.ts → appStorage
    };
    window.addEventListener('presensi-scheduler-toggle', handler);
    return () => window.removeEventListener('presensi-scheduler-toggle', handler);
  }, []);

  // Listen perubahan pengingat produktivitas dari halaman Automasi
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<{
        aktif?: boolean;
        jamBatas?: string;
        hariAktif?: HariKerja[];
      }>).detail;
      if (d.aktif     !== undefined) { setPengingatAktifState(d.aktif);   setPengingatAktifStorage(d.aktif); }
      if (d.jamBatas  !== undefined) { setJamBatasState(d.jamBatas);       setJamBatasStorage(d.jamBatas); }
      if (d.hariAktif !== undefined) { setHariAktifState(d.hariAktif);    setHariAktifPengingatStorage(d.hariAktif); }
    };
    window.addEventListener('ponorogo-pengingat-update', handler);
    return () => window.removeEventListener('ponorogo-pengingat-update', handler);
  }, []);

  const schedulerCtx = (pegawai && config && username)
    ? { username, config, pegawai: pegawai as any }
    : null;

  const nativePreferred = isNativeAutomationPreferred();

  useEffect(() => {
    if (!nativePreferred) return;
    setNativeScheduler('ponorogo', penjadwalAktif);
  }, [nativePreferred, penjadwalAktif]);

  useEffect(() => {
    if (!nativePreferred || !username) return;

    (async () => {
      try {
        const [stockFotos, unifiedPresets, unifiedStock] = await Promise.all([
          bacaSemuaStockFoto().catch(() => [] as any[]),
          bacaSemuaPresetUnified(username, 'ponorogo').catch(() => [] as any[]),
          bacaSemuaStockFotoUnified().catch(() => [] as any[]),
        ]);

        const legacyStock = (stockFotos as any[]).map(f => ({ id: String(f.id), nama: String(f.nama || ''), dataUrl: String(f.dataUrl || '') }));
        const unifiedIds = new Set<string>();
        for (const p of unifiedPresets as any[]) for (const id of (p.stockFotoIds || [])) unifiedIds.add(String(id));
        const unifiedStockMapped = (unifiedStock as any[])
          .filter((f: any) => unifiedIds.size === 0 || unifiedIds.has(String(f.id)))
          .map((f: any) => ({ id: String(f.id), nama: String(f.nama || ''), dataUrl: String(f.dataUrl || '') }));

        // Gabungkan stock foto agar preset legacy & unified (jika ada) tetap bisa dieksekusi native
        const stockById = new Map<string, any>();
        for (const s of [...legacyStock, ...unifiedStockMapped]) stockById.set(String(s.id), s);

        const hasActive = (presets || []).some((p: any) => p?.aktif) || (unifiedPresets || []).some((p: any) => p?.aktif);

        await syncNativeAutomation({
          profiles: {
            ponorogo: {
              profile_id: 'ponorogo',
              mode: 'ponorogo-absensi',
              gateway_url: '',
              ep_base_url: '',
              ponorogo_api_base: 'http://103.109.206.102:8089/Ponorogo-absensApi/index.php',
              scheduler_enabled: hasActive ? true : penjadwalAktif,
              username,
              ponorogo: { config: config || {}, pegawai: (pegawai as any) || {} },
              unified_presets: unifiedPresets || [],
              legacy_ponorogo_presets: presets || [],
              locations: [],
              stock_photos: Array.from(stockById.values()),
            }
          }
        } as any);

        if (hasActive) {
          try { await setNativeScheduler('ponorogo', true); } catch {}
        }
      } catch (e) {
        console.warn('[GlobalAutomasiScheduler] native sync gagal', e);
      }
    })();
    return () => {};
  }, [nativePreferred, username, penjadwalAktif, presets, config, pegawai]);

  useAutomasiScheduler({
    presets,
    aktif: !nativePreferred && penjadwalAktif && ready && !!schedulerCtx,
    ctx: schedulerCtx,
  });

  usePengingatProduktivitas({
    aktif:     pengingatAktif && !!config?.idPegawai,
    idPegawai: config?.idPegawai || null,
    jamBatas,
    hariAktif,
  });

  // Tidak render UI
  return null;
}
