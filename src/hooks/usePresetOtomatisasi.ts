/**
 * Hook untuk mengelola state daftar preset otomatisasi presensi (profile-aware).
 */

import { useCallback, useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import {
  bacaSemuaPreset,
  tambahPreset as libTambah,
  perbaruiPreset as libPerbarui,
  hapusPreset as libHapus,
  toggleAktifPreset as libToggle,
  type PresetOtomatisasi,
} from '../lib/presetOtomatisasi';

export interface UsePresetOtomatisasiReturn {
  presets: PresetOtomatisasi[];
  loading: boolean;
  tambahPreset: (data: Omit<PresetOtomatisasi, 'id' | 'dibuatPada' | 'diperbarui'>) => Promise<void>;
  perbaruiPreset: (id: string, data: Partial<PresetOtomatisasi>) => Promise<void>;
  hapusPreset: (id: string) => Promise<void>;
  toggleAktif: (id: string) => Promise<void>;
  muat: () => Promise<void>;
}

export function usePresetOtomatisasi(): UsePresetOtomatisasiReturn {
  const { pegawai, loginForm, serverProfileId } = useAppContext();
  const username = pegawai?.nip || loginForm.username || '';

  const [presets, setPresets] = useState<PresetOtomatisasi[]>([]);
  const [loading, setLoading] = useState(true);

  const muat = useCallback(async () => {
    if (!username) {
      setPresets([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await bacaSemuaPreset(username, serverProfileId);
      setPresets(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [username, serverProfileId]);

  useEffect(() => { void muat(); }, [muat]);

  const tambahPreset = useCallback(async (data: Omit<PresetOtomatisasi, 'id' | 'dibuatPada' | 'diperbarui'>) => {
    if (!username) return;
    await libTambah(username, data, serverProfileId);
    await muat();
  }, [username, serverProfileId, muat]);

  const perbaruiPreset = useCallback(async (id: string, data: Partial<PresetOtomatisasi>) => {
    if (!username) return;
    await libPerbarui(username, id, data, serverProfileId);
    await muat();
  }, [username, serverProfileId, muat]);

  const hapusPreset = useCallback(async (id: string) => {
    if (!username) return;
    await libHapus(username, id, serverProfileId);
    await muat();
  }, [username, serverProfileId, muat]);

  const toggleAktif = useCallback(async (id: string) => {
    if (!username) return;
    await libToggle(username, id, serverProfileId);
    await muat();
  }, [username, serverProfileId, muat]);

  return { presets, loading, tambahPreset, perbaruiPreset, hapusPreset, toggleAktif, muat };
}
