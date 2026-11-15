/**
 * Hook scheduler auto-presensi yang berjalan di background.
 *
 * Polling setiap 30 detik, memeriksa preset yang layak dieksekusi,
 * memilih lokasi secara acak dari pool, lalu memanggil rpcAbsen.
 *
 * Setelah presensi berhasil/gagal, dikirim notifikasi native Tauri
 * (notifikasi desktop / web).
 *
 * Polling berhenti otomatis bila:
 * - `aktif` = false
 * - komponen di-unmount (cleanup useEffect)
 * - pengguna tidak punya username (belum login)
 *
 * Listener `visibilitychange` memicu pengecekan ulang
 * segera saat aplikasi kembali ke foreground.
 */

import { useEffect, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import { useServerContext } from './useServerContext';
import {
  pilihLokasiAcak,
  tulisLog,
  sudahDieksekusiHariIni,
  hariIniAktif,
  waktuAcakPresetSudahTiba,
  ambilFotoBerikutnya,
  bacaStockFotoById,
  type PresetOtomatisasi,
} from '../lib/presetOtomatisasi';
import { getTodayWIB, getNowWIBTime } from '../lib/dateFormatter';
import { rpcAbsen } from '../lib/apiCalls';
import { ABSEN_CHECK_TYPE, formatLatLong } from '../lib/presensiContract';
import type { ServerContext } from '../lib/apiCalls';
import { bacaTitik } from '../lib/lokasiTersimpan';
import { getServerProfile } from '../lib/serverProfiles';
import { submitPonorogoPresensiOtomatis } from '../lib/apiCalls';

// ═══════════════════════════════════════════════════════════════════════
//  Interval polling (ms)
// ═══════════════════════════════════════════════════════════════════════

const INTERVAL_MS = 30_000; // 30 detik

// ═══════════════════════════════════════════════════════════════════════
//  Opsi hook
// ═══════════════════════════════════════════════════════════════════════

export interface UseAutoPresensiOptions {
  /** Daftar preset yang akan diperiksa. */
  presets: PresetOtomatisasi[];
  /** Bila false, polling tidak berjalan. */
  aktif: boolean;
  /** Callback opsional setelah eksekusi preset berhasil. */
  onEksekusi?: (preset: PresetOtomatisasi, lokasiId: string) => void;
}

// ═══════════════════════════════════════════════════════════════════════
//  Notifikasi native Tauri
// ═══════════════════════════════════════════════════════════════════════

/**
 * Kirim notifikasi native (Tauri desktop / Web Notification API).
 * 1. Coba Tauri plugin-notification (Linux desktop).
 * 2. Fallback ke Web Notification API atau console.
 */
async function kirimNotifikasiNative(judul: string, isi: string): Promise<void> {
  // 1. Tauri Plugin Notification (Desktop Linux)
  try {
    // Dynamic import — berjalan hanya di runtime Tauri, tidak melempar di browser biasa.
    const { sendNotification, isPermissionGranted, requestPermission } =
      await import('@tauri-apps/plugin-notification');

    let permitted: boolean = await isPermissionGranted();
    if (!permitted) {
      const permission: string = await requestPermission();
      permitted = permission === 'granted';
    }
    if (permitted) {
      await sendNotification({ title: judul, body: isi });
      return;
    }
  } catch {
    // Di luar Tauri atau plugin tidak aktif
  }

  // 3. Web Notification API fallback
  try {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification(judul, { body: isi, icon: '/icons/128x128.png' });
        return;
      } else if (Notification.permission !== 'denied') {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          new Notification(judul, { body: isi, icon: '/icons/128x128.png' });
          return;
        }
      }
    }
  } catch {
    // Abaikan
  }

  console.info(`[Preset Auto] ${judul}: ${isi}`);
}

// ═══════════════════════════════════════════════════════════════════════
//  Peta tipe preset → checktype
// ═══════════════════════════════════════════════════════════════════════

function checkTypeFromTipe(tipe: PresetOtomatisasi['tipe']): number {
  switch (tipe) {
    case 'datang': return ABSEN_CHECK_TYPE.DATANG;
    case 'pulang': return ABSEN_CHECK_TYPE.PULANG;
    case 'custom': return ABSEN_CHECK_TYPE.SIANG;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Logika cek & eksekusi preset (fully async, IndexedDB-aware)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Iterasi semua preset, periksa kondisi layak eksekusi (async karena
 * sudahDieksekusiHariIni sekarang IndexedDB), lalu jalankan rpcAbsen.
 */
async function cekDanEksekusiPreset(
  presets: PresetOtomatisasi[],
  username: string,
  context: ServerContext,
  profileId: string,
  pegawai: any,
  onEksekusi?: (preset: PresetOtomatisasi, lokasiId: string) => void,
): Promise<void> {
  const jamSekarang = getNowWIBTime();
  const tanggalHariIni = getTodayWIB();
  const hariSekarang = new Date().getDay();
  const lokasiTersimpan = await bacaTitik(username);
  const profile = getServerProfile(profileId);

  for (const preset of presets) {
    if (!preset.aktif) continue;
    if (!hariIniAktif(preset.hariAktif, hariSekarang)) continue;
    if (!waktuAcakPresetSudahTiba(preset.id, tanggalHariIni, preset.jamMulai, preset.jamSelesai, jamSekarang)) continue;
    if (await sudahDieksekusiHariIni(username, preset.id, tanggalHariIni, profileId)) continue;

    // Lokasi (opsional untuk beberapa mode, tapi dipakai bila ada pool)
    const lokasiValid = (preset.lokasiIds || []).filter(id => lokasiTersimpan.some(lokasi => lokasi.id === id));
    const lokasiId = lokasiValid.length ? pilihLokasiAcak(lokasiValid) : '';
    const lokasi = lokasiId ? lokasiTersimpan.find(item => item.id === lokasiId) : null;
    let ctxDenganLokasi: ServerContext = context;
    if (lokasi) ctxDenganLokasi = { ...context, lastLatLong: formatLatLong(lokasi.latitude, lokasi.longitude) };

    try {
      if (profile.mode === 'ponorogo-absensi') {
        const stockIds = Array.isArray(preset.stockFotoIds) ? preset.stockFotoIds : [];
        if (stockIds.length === 0) throw new Error('Preset Ponorogo membutuhkan minimal 1 foto.');
        const fotoId = await ambilFotoBerikutnya(preset.id, stockIds);
        if (!fotoId) throw new Error('Tidak ada foto yang tersedia untuk preset ini.');
        const foto = await bacaStockFotoById(fotoId);
        if (!foto?.dataUrl) throw new Error('Foto preset tidak ditemukan.');
        const result = await submitPonorogoPresensiOtomatis({
          preset,
          fotoDataUrl: foto.dataUrl,
          tanggal: tanggalHariIni,
          pegawai,
          latitude: lokasi?.latitude ?? null,
          longitude: lokasi?.longitude ?? null,
        });
        if (!result?.success) throw new Error(result?.message || 'Server Ponorogo menolak presensi.');
        await tulisLog(username, { presetId: preset.id, tanggal: tanggalHariIni, lokasiDipilih: lokasiId || '', fotoDipilih: fotoId, eksekusiPada: Date.now(), berhasil: true, pesan: result?.message || `Berhasil via ${lokasi?.nama ?? 'lokasi terpilih'}.` }, profileId);
        await kirimNotifikasiNative('✅ Presensi Otomatis Berhasil', `${preset.nama} — ${result?.message || 'Berhasil'}`);
        onEksekusi?.(preset, lokasiId || '');
        continue;
      }

      // BKD RPC mode
      if (!lokasiId) throw new Error('Tidak ada lokasi valid dalam pool preset.');
      if (!preset.workcodeId) throw new Error('Workcode preset belum dipilih.');
      const result = await rpcAbsen(ctxDenganLokasi, {
        checkType: checkTypeFromTipe(preset.tipe),
        workCode: preset.workcodeId,
        isWfh: false,
        withIjin: false,
        keterangan: '',
        mock: false,
      });
      if (result === null) throw new Error('Server pusat tidak mengembalikan respon absensi.');
      if ((result as any).absen === false) throw new Error((result as any).message || 'Server pusat menolak absensi.');

      await tulisLog(username, { presetId: preset.id, tanggal: tanggalHariIni, lokasiDipilih: lokasiId, eksekusiPada: Date.now(), berhasil: true, pesan: `Berhasil via ${lokasi?.nama ?? lokasiId}.` }, profileId);
      await kirimNotifikasiNative('✅ Presensi Otomatis Berhasil', `${preset.nama} — ${lokasi?.nama ?? lokasiId}`);
      onEksekusi?.(preset, lokasiId);
    } catch (err: unknown) {
      const pesan = err instanceof Error ? err.message : 'Gagal menghubungi server.';
      await tulisLog(username, { presetId: preset.id, tanggal: tanggalHariIni, lokasiDipilih: lokasiId || '', eksekusiPada: Date.now(), berhasil: false, pesan }, profileId);
      await kirimNotifikasiNative('⚠️ Presensi Otomatis Gagal', `${preset.nama}: ${pesan}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Hook
// ═══════════════════════════════════════════════════════════════════════

export function useAutoPresensi({
  presets,
  aktif,
  onEksekusi,
}: UseAutoPresensiOptions): void {
  const { pegawai, loginForm, serverProfileId } = useAppContext();
  const { context, ready } = useServerContext();

  const username = pegawai?.nip || loginForm.username || '';

  const presetsRef = useRef(presets);
  const contextRef = useRef(context);
  const onEksekusiRef = useRef(onEksekusi);
  const profileIdRef = useRef(serverProfileId);
  const pegawaiRef = useRef(pegawai);

  useEffect(() => { presetsRef.current = presets; }, [presets]);
  useEffect(() => { contextRef.current = context; }, [context]);
  useEffect(() => { onEksekusiRef.current = onEksekusi; }, [onEksekusi]);
  useEffect(() => { profileIdRef.current = serverProfileId; }, [serverProfileId]);
  useEffect(() => { pegawaiRef.current = pegawai; }, [pegawai]);

  useEffect(() => {
    if (!aktif || !username || !ready) return;
    let running = false;

    const eksekusi = async () => {
      if (running) return;
      running = true;
      try {
        await cekDanEksekusiPreset(
          presetsRef.current,
          username,
          contextRef.current,
          profileIdRef.current,
          pegawaiRef.current,
          onEksekusiRef.current,
        );
      } finally {
        running = false;
      }
    };

    void eksekusi();
    const intervalId = window.setInterval(() => { void eksekusi(); }, INTERVAL_MS);
    const handleVisibility = () => { if (document.visibilityState === 'visible') void eksekusi(); };
    const handleBackgroundTick = () => { void eksekusi(); };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('presensi-background-tick', handleBackgroundTick);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('presensi-background-tick', handleBackgroundTick);
    };
  }, [aktif, username, ready]);
}
