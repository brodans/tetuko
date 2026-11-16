// ─────────────────────────────────────────────────────────────────────────────
// GlobalAutomasiScheduler — helper & pengingat produktivitas (tanpa eksekusi preset JS).
// Backend eksekusi preset automasi berjalan di Rust native (Tauri).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { usePonorogoAppContext as useAppContext } from '../context/AppContext';
import { setPenjadwalAktif, HariKerja } from '../lib/presetAutomasi';
import { usePengingatProduktivitas } from '../hooks/usePengingatProduktivitas';
import { appStorage } from '../lib/appStorage';

// ─── Kunci IndexedDB (via appStorage) ─────────────────────────────────────────
const KEY_PENGINGAT_AKTIF = 'pengingat_produktivitas_aktif';
const KEY_JAM_BATAS       = 'pengingat_jam_batas';
const KEY_HARI_AKTIF      = 'pengingat_hari_aktif';

const HARI_DEFAULT: HariKerja[] = [1, 2, 3, 4, 5]; // Senin–Jumat

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
  } catch {}
  return HARI_DEFAULT;
}
export function setHariAktifPengingatStorage(v: HariKerja[]): void {
  appStorage.setItem(KEY_HARI_AKTIF, JSON.stringify(v));
}

// ─────────────────────────────────────────────────────────────────────────────
export default function GlobalAutomasiScheduler() {
  const { config } = useAppContext();

  const [pengingatAktif, setPengingatAktifState] = useState<boolean>(() => getPengingatAktif());
  const [jamBatas,       setJamBatasState]       = useState<string>(() => getJamBatas());
  const [hariAktif,      setHariAktifState]      = useState<HariKerja[]>(() => getHariAktifPengingat());

  // Sinkronisasi status penjadwal legacy (storage/event) untuk UI halaman Automasi
  useEffect(() => {
    const handler = (e: Event) => {
      const aktif = (e as CustomEvent<{ aktif: boolean }>).detail?.aktif;
      if (typeof aktif === 'boolean') setPenjadwalAktif(aktif);
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
      }>).detail || {};
      if (d.aktif     !== undefined) { setPengingatAktifState(d.aktif);   setPengingatAktifStorage(d.aktif); }
      if (d.jamBatas  !== undefined) { setJamBatasState(d.jamBatas);       setJamBatasStorage(d.jamBatas); }
      if (d.hariAktif !== undefined) { setHariAktifState(d.hariAktif);     setHariAktifPengingatStorage(d.hariAktif); }
    };
    window.addEventListener('ponorogo-pengingat-update', handler);
    return () => window.removeEventListener('ponorogo-pengingat-update', handler);
  }, []);

  usePengingatProduktivitas({
    aktif:     pengingatAktif && !!config?.idPegawai,
    idPegawai: config?.idPegawai || null,
    jamBatas,
    hariAktif,
  });

  return null;
}
