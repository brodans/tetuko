import { useEffect, useMemo, useState } from 'react';
import { Search, MapPin, Zap } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Field, Input, ActionButton } from './ui/Surface';
import Dropdown from './ui/Dropdown';
import TimePicker from './ui/TimePicker';
import StockFotoManager from './ui/StockFotoManager';
import type { PresetOtomatisasi, TipePreset, HariKerja, StockFoto } from '../lib/presetOtomatisasi';
import { LABEL_HARI, URUTAN_HARI } from '../lib/presetOtomatisasi';
import type { TitikAbsen } from '../lib/lokasiTersimpan';
import type { WorkCodeView } from '../lib/viewModels';

export interface PresetFormModalProps {
  buka: boolean;
  onTutup: () => void;
  onSimpan: (data: Omit<PresetOtomatisasi, 'id' | 'dibuatPada' | 'diperbarui'>) => void;
  preset?: PresetOtomatisasi | null;
  lokasiTersimpan: TitikAbsen[];
  workcodes: WorkCodeView[];
  requiresWorkCode?: boolean;
  requiresPhoto?: boolean;
  stockFotos?: StockFoto[];
  onTambahFoto?: (data: Omit<StockFoto, 'id' | 'dibuatPada'>) => Promise<StockFoto | null | void>;
  onHapusFoto?: (id: string) => Promise<void>;
}

interface FormState {
  nama: string;
  tipe: TipePreset;
  workcodeId: string;
  jamMulai: string;
  jamSelesai: string;
  hariAktif: HariKerja[];
  lokasiIds: string[];
  stockFotoIds: string[];
  aktif: boolean;
}

const FORM_KOSONG: FormState = {
  nama: '',
  tipe: 'datang',
  workcodeId: '',
  jamMulai: '07:00',
  jamSelesai: '09:00',
  hariAktif: [1, 2, 3, 4, 5],
  lokasiIds: [],
  stockFotoIds: [],
  aktif: true,
};

const TIPE_OPTIONS: { tipe: TipePreset; label: string }[] = [
  { tipe: 'datang', label: 'Datang' },
  { tipe: 'pulang', label: 'Pulang' },
  { tipe: 'custom', label: 'Absen Siang' },
];

const MAKS_LOKASI = 20;

export default function PresetFormModal({
  buka,
  onTutup,
  onSimpan,
  preset,
  lokasiTersimpan,
  workcodes,
  requiresWorkCode = true,
  requiresPhoto = false,
  stockFotos = [],
  onTambahFoto,
  onHapusFoto,
}: PresetFormModalProps) {
  const modeEdit = preset != null;
  const [form, setForm] = useState<FormState>(FORM_KOSONG);
  const [cariLokasi, setCariLokasi] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!buka) return;
    if (preset) {
      setForm({
        nama: preset.nama,
        tipe: preset.tipe,
        workcodeId: preset.workcodeId || '',
        jamMulai: preset.jamMulai,
        jamSelesai: preset.jamSelesai,
        hariAktif: [...preset.hariAktif],
        lokasiIds: [...(preset.lokasiIds || [])],
        stockFotoIds: [...(preset.stockFotoIds || [])],
        aktif: preset.aktif,
      });
    } else {
      setForm(FORM_KOSONG);
    }
    setCariLokasi('');
    setError(null);
  }, [buka, preset]);

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) => setForm(prev => ({ ...prev, [key]: val }));

  const toggleHari = (hari: HariKerja) => {
    setForm(prev => {
      const sudahAda = prev.hariAktif.includes(hari);
      return { ...prev, hariAktif: sudahAda ? prev.hariAktif.filter(h => h !== hari) : [...prev.hariAktif, hari] };
    });
  };

  const toggleLokasi = (id: string) => {
    setForm(prev => {
      const sudahAda = prev.lokasiIds.includes(id);
      if (sudahAda) return { ...prev, lokasiIds: prev.lokasiIds.filter(l => l !== id) };
      if (prev.lokasiIds.length >= MAKS_LOKASI) return prev;
      return { ...prev, lokasiIds: [...prev.lokasiIds, id] };
    });
  };

  const lokasiFiltrat = useMemo(() => {
    const q = cariLokasi.trim().toLowerCase();
    if (!q) return lokasiTersimpan;
    return lokasiTersimpan.filter(lokasi => lokasi.nama.toLowerCase().includes(q) || `${lokasi.latitude},${lokasi.longitude}`.includes(q));
  }, [lokasiTersimpan, cariLokasi]);

  const opsiWorkcode = useMemo(() => workcodes.map(w => ({ value: String(w.id), label: w.nama })), [workcodes]);

  const handleSimpan = () => {
    if (!form.nama.trim()) { setError('Nama preset wajib diisi.'); return; }
    if (requiresWorkCode && !form.workcodeId) { setError('Workcode wajib dipilih untuk server ini.'); return; }
    if (form.hariAktif.length === 0) { setError('Pilih minimal satu hari aktif.'); return; }
    if (requiresPhoto) {
      if (form.stockFotoIds.length === 0) { setError('Pilih minimal satu foto untuk preset Ponorogo.'); return; }
      // lokasi opsional tapi sangat disarankan; tetap izinkan kosong jika belum ada titik
    } else {
      if (form.lokasiIds.length === 0) { setError('Pilih minimal satu lokasi dalam pool.'); return; }
    }
    setError(null);
    onSimpan({
      nama: form.nama.trim(),
      tipe: form.tipe,
      workcodeId: form.workcodeId,
      jamMulai: form.jamMulai,
      jamSelesai: form.jamSelesai,
      hariAktif: [...form.hariAktif],
      lokasiIds: [...form.lokasiIds],
      stockFotoIds: requiresPhoto ? [...form.stockFotoIds] : undefined,
      aktif: form.aktif,
    });
  };

  return (
    <Modal
      open={buka}
      onClose={onTutup}
      size="lg"
      title={modeEdit ? 'Edit Preset' : 'Tambah Preset'}
      icon={<Zap className="w-4 h-4 text-amber-500" />}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <ActionButton variant="ghost" size="sm" onClick={onTutup}>Batal</ActionButton>
          <ActionButton variant="primary" size="sm" onClick={handleSimpan}>{modeEdit ? 'Simpan Perubahan' : 'Tambah Preset'}</ActionButton>
        </div>
      }
    >
      <div className="space-y-5">
        {error && <p className="text-xs font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-xl px-3.5 py-2.5">{error}</p>}

        <Field label="Nama Preset" required>
          <Input placeholder="Contoh: Datang Pagi Otomatis" value={form.nama} onChange={e => set('nama', e.target.value)} maxLength={80} />
        </Field>

        <Field label="Tipe Presensi">
          <div className="flex gap-2">
            {TIPE_OPTIONS.map(({ tipe, label }) => (
              <button key={tipe} type="button" onClick={() => set('tipe', tipe)} className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-colors ${form.tipe === tipe ? (tipe === 'datang' ? 'bg-emerald-600 border-emerald-600 text-white' : tipe === 'pulang' ? 'bg-amber-500 border-amber-500 text-white' : 'bg-violet-600 border-violet-600 text-white') : 'bg-white dark:bg-slate-900/50 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>{label}</button>
            ))}
          </div>
        </Field>

        {requiresWorkCode && (
          <Field label="Workcode" required hint={opsiWorkcode.length === 0 ? 'Daftar workcode tidak tersedia di sini. Isi ID/kode workcode secara manual jika diketahui.' : undefined}>
            {opsiWorkcode.length > 0 ? (
              <Dropdown value={form.workcodeId} onChange={val => set('workcodeId', val)} opsi={opsiWorkcode} placeholder="— Pilih workcode —" searchable />
            ) : (
              <Input
                placeholder="Masukkan ID/kode workcode"
                value={form.workcodeId}
                onChange={e => set('workcodeId', e.target.value)}
              />
            )}
          </Field>
        )}

        <Field label="Rentang Jam Eksekusi">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <TimePicker value={form.jamMulai} onChange={v => set('jamMulai', v)} className="w-full" />
            </div>
            <span className="text-slate-400 text-sm shrink-0">–</span>
            <div className="flex-1 min-w-0">
              <TimePicker value={form.jamSelesai} onChange={v => set('jamSelesai', v)} className="w-full" />
            </div>
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 ml-1 mt-1">Preset dieksekusi pada waktu acak yang tetap dalam rentang ini.</p>
        </Field>

        <Field label="Hari Aktif">
          <div className="flex flex-wrap gap-1.5">
            {URUTAN_HARI.map(hari => {
              const aktif = form.hariAktif.includes(hari);
              return (
                <button key={hari} type="button" onClick={() => toggleHari(hari)} className={`px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${aktif ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white dark:bg-slate-900/50 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'}`}>{LABEL_HARI[hari]}</button>
              );
            })}
          </div>
        </Field>

        {requiresPhoto && onTambahFoto && onHapusFoto && (
          <Field label="Foto Presensi (Ponorogo/Ponorogo)" hint="Pilih foto yang akan dipakai bergiliran saat automasi berjalan." required>
            <StockFotoManager
              fotos={stockFotos}
              selectedIds={form.stockFotoIds}
              onSelect={(ids) => set('stockFotoIds', ids)}
              onTambah={onTambahFoto}
              onHapus={onHapusFoto}
              maxSelect={20}
            />
          </Field>
        )}

        <Field label={requiresPhoto ? 'Lokasi (opsional)' : 'Pool Lokasi'} hint={`${form.lokasiIds.length} dipilih / maks ${MAKS_LOKASI}${requiresPhoto ? ' (koordinat akan ikut jika dipilih)' : ''}`} required={!requiresPhoto}>
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input placeholder="Cari nama/kode lokasi..." value={cariLokasi} onChange={e => setCariLokasi(e.target.value)} className="pl-9 text-sm" />
          </div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {form.lokasiIds.length > 0 ? `${form.lokasiIds.length} lokasi dipilih` : 'Belum ada lokasi dipilih'}
            </span>
            <div className="flex items-center gap-2">
              {lokasiFiltrat.length > 0 && form.lokasiIds.length < MAKS_LOKASI && (
                <button
                  type="button"
                  onClick={() => {
                    const ids = lokasiFiltrat.map(l => l.id).slice(0, MAKS_LOKASI);
                    set('lokasiIds', ids);
                  }}
                  className="text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
                >
                  Pilih semua
                </button>
              )}
              {form.lokasiIds.length > 0 && (
                <button type="button" onClick={() => set('lokasiIds', [])} className="text-[11px] text-rose-500 hover:text-rose-600 font-medium">Hapus semua</button>
              )}
            </div>
          </div>
          <div className="max-h-44 overflow-y-auto custom-scrollbar rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700/60">
            {lokasiFiltrat.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">{cariLokasi ? 'Tidak ada lokasi yang cocok.' : 'Belum ada lokasi tersimpan di perangkat.'}</p>
            ) : (
              lokasiFiltrat.map(lokasi => {
                const dipilih = form.lokasiIds.includes(lokasi.id);
                const dinonaktifkan = !dipilih && form.lokasiIds.length >= MAKS_LOKASI;
                return (
                  <button key={lokasi.id} type="button" disabled={dinonaktifkan} onClick={() => toggleLokasi(lokasi.id)} className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${dipilih ? 'bg-blue-50 dark:bg-blue-500/10' : dinonaktifkan ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}>
                    <span className={`w-4 h-4 rounded-md border-2 shrink-0 flex items-center justify-center transition-colors ${dipilih ? 'bg-blue-600 border-blue-600' : 'border-slate-300 dark:border-slate-600'}`}>
                      {dipilih && <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                    </span>
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">{lokasi.nama}</span>
                      <span className="block text-[10px] text-slate-400 dark:text-slate-500">{lokasi.latitude}, {lokasi.longitude}</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
