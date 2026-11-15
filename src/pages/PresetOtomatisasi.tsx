import { useEffect, useState, useCallback } from 'react';
import { Zap, Plus, Pencil, Trash2, Power, PowerOff, Clock, MapPin, CalendarDays, Image as ImageIcon } from 'lucide-react';
import { PageHeader, Card, Badge, EmptyState, SkeletonList, ActionButton, Alert } from '../components/ui/Surface';
import { ConfirmDialog } from '../components/ui/Modal';
import PresetFormModal from '../components/PresetFormModal';
import StockFotoManager from '../components/ui/StockFotoManager';
import { usePresetOtomatisasi } from '../hooks/usePresetOtomatisasi';
import { useServerContext } from '../hooks/useServerContext';
import { useToast } from '../components/ui/Toast';
import {
  LABEL_HARI,
  bacaLogHarian,
  bacaSemuaStockFoto,
  tambahStockFoto,
  hapusStockFoto,
  type PresetOtomatisasi,
  type LogEksekusi,
  type StockFoto,
} from '../lib/presetOtomatisasi';
import { getTodayWIB } from '../lib/dateFormatter';
import { rpcGetWorkCode } from '../lib/apiCalls';
import { useAppContext } from '../context/AppContext';
import type { WorkCodeView } from '../lib/viewModels';
import { bacaTitik, type TitikAbsen } from '../lib/lokasiTersimpan';
import { getPenjadwalAktifStorage, setPenjadwalAktifStorage, notifyPresetUpdated } from '../components/GlobalPresetScheduler';

function TipeBadge({ tipe }: { tipe: PresetOtomatisasi['tipe'] }) {
  if (tipe === 'datang') return <Badge tone="emerald">Datang</Badge>;
  if (tipe === 'pulang') return <Badge tone="amber">Pulang</Badge>;
  return <Badge tone="violet">Absen Siang</Badge>;
}

function KartuPreset({
  preset, workcodeNama, lokasiCount, fotoCount, logTerakhir, onToggle, onEdit, onHapus,
}: {
  preset: PresetOtomatisasi; workcodeNama: string; lokasiCount: number; fotoCount: number; logTerakhir: string | null;
  onToggle: () => void; onEdit: () => void; onHapus: () => void;
}) {
  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{preset.nama}</p>
            <TipeBadge tipe={preset.tipe} />
            {preset.aktif ? <Badge tone="emerald">Aktif</Badge> : <Badge tone="slate">Nonaktif</Badge>}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5 col-span-2 sm:col-span-1"><Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" /><span className="text-xs text-slate-600 dark:text-slate-300">{preset.jamMulai} – {preset.jamSelesai}</span></div>
        <div className="flex items-center gap-1.5 col-span-2 sm:col-span-1"><MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" /><span className="text-xs text-slate-600 dark:text-slate-300">{lokasiCount} lokasi</span></div>
        {fotoCount > 0 && <div className="flex items-center gap-1.5 col-span-2 sm:col-span-1"><ImageIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" /><span className="text-xs text-slate-600 dark:text-slate-300">{fotoCount} foto</span></div>}
        {workcodeNama ? <div className="col-span-2"><span className="text-[11px] text-slate-400 dark:text-slate-500">Workcode: {workcodeNama}</span></div> : null}
      </div>
      <div className="flex items-center gap-1.5">
        <CalendarDays className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <div className="flex flex-wrap gap-1">
          {([0,1,2,3,4,5,6] as Array<0|1|2|3|4|5|6>).map(h => (
            <span key={h} className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${preset.hariAktif.includes(h) ? 'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300' : 'bg-slate-100 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500'}`}>{LABEL_HARI[h]}</span>
          ))}
        </div>
      </div>
      {logTerakhir && <p className="text-[11px] text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-700/50 pt-2">Eksekusi terakhir: {logTerakhir}</p>}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-700/50">
        <ActionButton variant={preset.aktif ? 'warning' : 'success'} size="sm" icon={preset.aktif ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />} onClick={onToggle}>{preset.aktif ? 'Nonaktifkan' : 'Aktifkan'}</ActionButton>
        <ActionButton variant="ghost" size="sm" icon={<Pencil className="w-3.5 h-3.5" />} onClick={onEdit}>Edit</ActionButton>
        <ActionButton variant="danger" size="sm" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={onHapus}>Hapus</ActionButton>
      </div>
    </Card>
  );
}

export default function PagePresetOtomatisasi() {
  const { pegawai, loginForm, serverProfile, serverProfileId } = useAppContext();
  const { context, ready } = useServerContext();
  const toast = useToast();
  const username = pegawai?.nip || loginForm.username || '';
  const requiresPhoto = serverProfile.requiresPhotoPreset;
  const requiresWorkCode = serverProfile.requiresWorkCode;

  const [lokasiTersimpan, setLokasiTersimpan] = useState<TitikAbsen[]>([]);
  const [workcodes, setWorkcodes] = useState<WorkCodeView[]>([]);
  const [stockFotos, setStockFotos] = useState<StockFoto[]>([]);
  const [memuatData, setMemuatData] = useState(true);
  const [logsHarian, setLogsHarian] = useState<LogEksekusi[]>([]);

  const { presets, loading, tambahPreset, perbaruiPreset, hapusPreset, toggleAktif } = usePresetOtomatisasi();
  const [penjadwalAktif, setPenjadwalAktif] = useState<boolean>(() => getPenjadwalAktifStorage());
  const [modalBuka, setModalBuka] = useState(false);
  const [presetDiedit, setPresetDiedit] = useState<PresetOtomatisasi | null>(null);
  const [hapusTarget, setHapusTarget] = useState<PresetOtomatisasi | null>(null);

  const muatStock = useCallback(async () => {
    try { setStockFotos(await bacaSemuaStockFoto()); } catch { setStockFotos([]); }
  }, []);

  useEffect(() => {
    let hidup = true;
    setMemuatData(true);
    void (async () => {
      try {
        const [titik, fotos] = await Promise.all([
          bacaTitik(username),
          bacaSemuaStockFoto(),
        ]);
        let wc: WorkCodeView[] = [];
        if (ready && requiresWorkCode) {
          try { wc = await rpcGetWorkCode(context); } catch { wc = []; }
        }
        if (!hidup) return;
        setLokasiTersimpan(titik);
        setStockFotos(fotos);
        setWorkcodes(wc);
      } catch {
        if (!hidup) return;
      } finally {
        if (hidup) setMemuatData(false);
      }
    })();
    return () => { hidup = false; };
  }, [ready, context, username, requiresWorkCode, muatStock]);

  const muatLogsHarian = useCallback(async () => {
    if (!username) { setLogsHarian([]); return; }
    try { setLogsHarian(await bacaLogHarian(username, getTodayWIB(), serverProfileId)); } catch { setLogsHarian([]); }
  }, [username, serverProfileId]);
  useEffect(() => { void muatLogsHarian(); }, [muatLogsHarian]);

  const bukaModal = (preset?: PresetOtomatisasi) => { setPresetDiedit(preset ?? null); setModalBuka(true); };
  const tutupModal = () => { setModalBuka(false); setPresetDiedit(null); };

  const handleSimpan = async (data: Omit<PresetOtomatisasi, 'id' | 'dibuatPada' | 'diperbarui'>) => {
    if (presetDiedit) {
      await perbaruiPreset(presetDiedit.id, data);
      toast.success('Preset berhasil diperbarui.');
    } else {
      await tambahPreset(data);
      toast.success('Preset baru berhasil ditambahkan.');
    }
    notifyPresetUpdated();
    await muatLogsHarian();
    tutupModal();
  };

  const handleHapusKonfirmasi = async () => {
    if (!hapusTarget) return;
    await hapusPreset(hapusTarget.id);
    notifyPresetUpdated();
    toast.info(`Preset "${hapusTarget.nama}" dihapus.`);
    setHapusTarget(null);
  };

  const handleToggleAktif = async (presetId: string) => { await toggleAktif(presetId); notifyPresetUpdated(); };
  const handleTogglePenjadwal = () => {
    const baru = !penjadwalAktif;
    setPenjadwalAktif(baru);
    setPenjadwalAktifStorage(baru);
    toast.info(`Penjadwal presensi otomatis ${baru ? 'diaktifkan' : 'dinonaktifkan'}.`);
  };

  const namaWorkcode = (workcodeId: string): string => {
    if (!workcodeId) return '';
    const wc = workcodes.find(w => String(w.id) === String(workcodeId));
    return wc?.nama || workcodeId;
  };
  const logTerakhirPreset = (presetId: string): string | null => {
    const log = logsHarian.find(l => l.presetId === presetId);
    if (!log) return null;
    const jam = new Date(log.eksekusiPada).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    return `${jam} WIB — ${log.berhasil ? '✅ Berhasil' : '❌ Gagal'}${log.pesan ? ` (${log.pesan})` : ''}`;
  };

  const handleTambahFoto = async (data: Omit<StockFoto, 'id' | 'dibuatPada'>) => {
    const foto = await tambahStockFoto(data);
    setStockFotos(await bacaSemuaStockFoto());
    return foto;
  };
  const handleHapusFoto = async (id: string) => {
    await hapusStockFoto(id);
    setStockFotos(await bacaSemuaStockFoto());
  };

  const sedangMemuat = loading || memuatData;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Preset Otomatisasi"
        subtitle={`Konfigurasi absensi otomatis untuk ${serverProfile.nama} (${serverProfile.label})`}
        icon={<Zap className="w-5 h-5" />}
        action={
          <ActionButton variant="primary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => bukaModal()} disabled={sedangMemuat}>
            Tambah Preset
          </ActionButton>
        }
      />

      <Card padded={false} className="px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${penjadwalAktif ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Penjadwal <span className={penjadwalAktif ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}>{penjadwalAktif ? 'Aktif' : 'Nonaktif'}</span>
            </span>
            <Badge tone={penjadwalAktif ? 'emerald' : 'slate'}>{penjadwalAktif ? 'ON' : 'OFF'}</Badge>
          </div>
          <button type="button" role="switch" aria-checked={penjadwalAktif} onClick={handleTogglePenjadwal} className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${penjadwalAktif ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`}>
            <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out ${penjadwalAktif ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
        {!ready && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5">Menunggu koneksi/konteks server…</p>}
      </Card>

      {requiresPhoto && (
        <Alert tone="blue">
          Mode <strong>{serverProfile.nama} / {serverProfile.label}</strong> memerlukan foto untuk presensi otomatis (seperti Ponorogo). Kelola stock foto dan pilih foto pada setiap preset.
        </Alert>
      )}

      {requiresPhoto && (
        <StockFotoManager
          fotos={stockFotos}
          onTambah={handleTambahFoto}
          onHapus={handleHapusFoto}
          readOnly={false}
        />
      )}

      {sedangMemuat ? (
        <SkeletonList rows={3} />
      ) : presets.length === 0 ? (
        <EmptyState message="Belum ada preset otomatisasi" hint={`Tekan "Tambah Preset" untuk membuat aturan absensi otomatis untuk ${serverProfile.nama}.`} />
      ) : (
        <div className="space-y-3">
          {presets.map(preset => (
            <KartuPreset
              key={preset.id}
              preset={preset}
              workcodeNama={requiresWorkCode ? namaWorkcode(preset.workcodeId) : ''}
              lokasiCount={(preset.lokasiIds || []).length}
              fotoCount={(preset.stockFotoIds || []).length}
              logTerakhir={logTerakhirPreset(preset.id)}
              onToggle={() => void handleToggleAktif(preset.id)}
              onEdit={() => bukaModal(preset)}
              onHapus={() => setHapusTarget(preset)}
            />
          ))}
        </div>
      )}

      <PresetFormModal
        buka={modalBuka}
        onTutup={tutupModal}
        onSimpan={handleSimpan}
        preset={presetDiedit}
        lokasiTersimpan={lokasiTersimpan}
        workcodes={workcodes}
        requiresWorkCode={requiresWorkCode}
        requiresPhoto={requiresPhoto}
        stockFotos={stockFotos}
        onTambahFoto={handleTambahFoto}
        onHapusFoto={handleHapusFoto}
      />

      <ConfirmDialog
        open={hapusTarget !== null}
        title="Hapus Preset?"
        message={<>Preset <strong>"{hapusTarget?.nama}"</strong> akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.</>}
        confirmLabel="Ya, Hapus"
        tone="danger"
        onConfirm={() => void handleHapusKonfirmasi()}
        onCancel={() => setHapusTarget(null)}
      />
    </div>
  );
}
