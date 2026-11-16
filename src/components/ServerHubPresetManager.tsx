import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, CheckCircle2, Clock, Loader2, MapPin, Power, PowerOff, RefreshCw, Trash2, Zap, AlertTriangle, CalendarDays, Camera, Plus, Pencil } from 'lucide-react';
import { SERVER_PROFILES, getServerProfile, type ServerProfileId } from '../lib/serverProfiles';
import { loadServerCreds } from '../lib/loginCredsStore';
import { getTodayWIB, getNowWIBTime } from '../lib/dateFormatter';
import {
  bacaSemuaPreset,
  tambahPreset as tambahPresetUnified,
  perbaruiPreset as perbaruiPresetUnified,
  toggleAktifPreset,
  hapusPreset,
  bacaLogHarian,
  waktuAcakPreset,
  LABEL_HARI,
  bacaSemuaStockFoto,
  tambahStockFoto as tambahStockFotoUnified,
  hapusStockFoto as hapusStockFotoUnified,
  type PresetOtomatisasi,
  type LogEksekusi,
  type HariKerja,
  type StockFoto,
} from '../lib/presetOtomatisasi';
import {
  bacaSemuaPreset as bacaSemuaPresetLegacy,
  tambahPreset as tambahPresetLegacy,
  perbaruiPreset as perbaruiPresetLegacy,
  toggleAktifPreset as toggleAktifPresetLegacy,
  hapusPreset as hapusPresetLegacy,
  bacaLogHarian as bacaLogHarianLegacy,
  getTodayWIBAutomasi,
  NAMA_HARI as NAMA_HARI_LEGACY,
  bacaSemuaStockFoto as bacaSemuaStockFotoLegacy,
  tambahStockFoto as tambahStockFotoLegacy,
  hapusStockFoto as hapusStockFotoLegacy,
  type PresetAutomasi,
  type LogEksekusi as LogEksekusiLegacy,
  type HariKerja as HariKerjaLegacy,
  type StockFoto as StockFotoLegacy,
} from '../lib/presetAutomasi';
import { bacaTitik, type TitikAbsen } from '../lib/lokasiTersimpan';
import { getPenjadwalAktifStorage, setPenjadwalAktifStorage } from './GlobalPresetScheduler';
import { kirimNotifikasiNative } from '../lib/notifikasi';
import PresetFormModal from './PresetFormModal';
import PresetAutomasiFormModal from './PresetAutomasiFormModal';

type ProfileEntry = {
  profileId: ServerProfileId;
  profileName: string;
  label: string;
  mode: string;
  username: string;
  unified: PresetOtomatisasi[];
  legacy: PresetAutomasi[];
  unifiedLogs: LogEksekusi[];
  legacyLogs: LogEksekusiLegacy[];
  loading: boolean;
  error?: string;
};

function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return -1;
  const h = Number(m[1]); const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return -1;
  return h * 60 + mm;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'siap';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}j ${m}m ${s}d`;
  if (m > 0) return `${m}m ${s}d`;
  return `${s}d`;
}

function nextUnifiedTrigger(preset: PresetOtomatisasi, now: Date): { label: string; ms: number | null } {
  if (!preset.aktif) return { label: 'Nonaktif', ms: null };
  for (let add = 0; add < 7; add++) {
    const d = new Date(now.getTime() + add * 86400000);
    const day = d.getDay() as HariKerja;
    if (!preset.hariAktif.includes(day)) continue;
    const tanggal = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const target = waktuAcakPreset(preset.id, tanggal, preset.jamMulai, preset.jamSelesai);
    if (!target) continue;
    const nowWibStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now);
    const [, timePartRaw] = nowWibStr.replace(',', '').split(' ');
    const timePart = (timePartRaw || '00:00:00').slice(0,5);
    const nowSec = Number((timePartRaw || '00:00:00').slice(6,8) || '0');
    if (add === 0) {
      const targetMin = toMinutes(target);
      const nowMin = toMinutes(timePart);
      const deltaMin = targetMin - nowMin;
      const ms = deltaMin * 60000 - nowSec * 1000;
      if (ms >= -3600000) return { label: `Hari ini ${target} WIB`, ms };
      continue;
    } else {
      const nowMinToday = toMinutes(timePart);
      const targetMin = toMinutes(target);
      const ms = (add * 1440 + targetMin - nowMinToday) * 60000 - nowSec * 1000;
      return { label: `${tanggal} ${target} WIB`, ms };
    }
  }
  return { label: 'Tidak ada jadwal', ms: null };
}

function nextLegacyTrigger(preset: PresetAutomasi, now: Date): { label: string; ms: number | null } {
  if (!preset.aktif) return { label: 'Nonaktif', ms: null };
  const nowWibStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now);
  const [, timePartRaw] = nowWibStr.replace(',', '').split(' ');
  const nowTime = (timePartRaw || '00:00:00').slice(0,5);
  const nowSec = Number((timePartRaw || '00:00:00').slice(6,8) || '0');
  for (let add = 0; add < 7; add++) {
    const d = new Date(now.getTime() + add * 86400000);
    const day = d.getDay() as HariKerjaLegacy;
    if (!preset.hariAktif.includes(day)) continue;
    const tanggal = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const mulai = toMinutes(preset.jamMulai);
    const sekarang = toMinutes(nowTime);
    if (add === 0) {
      const selesai = toMinutes(preset.jamSelesai);
      const inRange = (mulai <= selesai) ? (sekarang >= mulai && sekarang <= selesai) : (sekarang >= mulai || sekarang <= selesai);
      if (inRange) return { label: `Hari ini ${preset.jamMulai}-${preset.jamSelesai}`, ms: 0 };
      if (sekarang < mulai) return { label: `Hari ini ${preset.jamMulai}`, ms: (mulai - sekarang) * 60000 - nowSec * 1000 };
      continue;
    }
    const ms = (add * 1440 + mulai - sekarang) * 60000 - nowSec * 1000;
    return { label: `${tanggal} ${preset.jamMulai}`, ms };
  }
  return { label: 'Tidak ada jadwal', ms: null };
}

function HariBadges({ hariAktif, labelMap }: { hariAktif: number[]; labelMap: Record<number, string> }) {
  const order = [1,2,3,4,5,6,0];
  return (
    <div className="flex flex-wrap gap-1">
      {order.map((h) => (
        <span key={h} className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${hariAktif.includes(h) ? 'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300' : 'bg-slate-100 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500'}`}>{labelMap[h as any]}</span>
      ))}
    </div>
  );
}

type UnifiedEditState = { profileId: ServerProfileId; username: string; preset: PresetOtomatisasi | null } | null;
type LegacyEditState = { username: string; preset: PresetAutomasi | null } | null;

export default function ServerHubPresetManager({ accountKey }: { accountKey: string }) {
  const [entries, setEntries] = useState<ProfileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [globalScheduler, setGlobalScheduler] = useState<boolean>(() => getPenjadwalAktifStorage());
  const [testingNotif, setTestingNotif] = useState(false);
  const [notifMsg, setNotifMsg] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [unifiedEdit, setUnifiedEdit] = useState<UnifiedEditState>(null);
  const [legacyEdit, setLegacyEdit] = useState<LegacyEditState>(null);
  const [formLocations, setFormLocations] = useState<TitikAbsen[]>([]);
  const [formStockUnified, setFormStockUnified] = useState<StockFoto[]>([]);
  const [formStockLegacy, setFormStockLegacy] = useState<StockFotoLegacy[]>([]);

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const today = getTodayWIB();
      const todayLegacy = getTodayWIBAutomasi();
      const rows = await Promise.all(SERVER_PROFILES.map(async (p) => {
        const profileId = p.id as ServerProfileId;
        const cred = await loadServerCreds(profileId, accountKey).catch(() => null);
        const username = (cred?.nip || '').trim();
        const base: ProfileEntry = {
          profileId, profileName: p.nama, label: p.label, mode: p.mode, username,
          unified: [], legacy: [], unifiedLogs: [], legacyLogs: [], loading: false,
        };
        if (!username) return { ...base, error: 'Kredensial belum tersimpan.' };
        try {
          const [u, ul] = await Promise.all([
            bacaSemuaPreset(username, profileId).catch(() => [] as PresetOtomatisasi[]),
            bacaLogHarian(username, today, profileId).catch(() => [] as LogEksekusi[]),
          ]);
          let legacy: PresetAutomasi[] = [];
          let legacyLogs: LogEksekusiLegacy[] = [];
          if (p.mode === 'ponorogo-absensi') {
            legacy = await bacaSemuaPresetLegacy(username).catch(() => [] as PresetAutomasi[]);
            legacyLogs = await bacaLogHarianLegacy(username, todayLegacy).catch(() => [] as LogEksekusiLegacy[]);
          }
          return { ...base, username, unified: u, unifiedLogs: ul, legacy, legacyLogs };
        } catch (e: any) {
          return { ...base, error: e?.message || 'Gagal memuat preset.' };
        }
      }));
      setEntries(rows);
    } finally {
      setLoading(false);
    }
  }, [accountKey]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  useEffect(() => {
    const onUpd = () => { void loadAll(); };
    const onToggle = (e: Event) => { setGlobalScheduler((e as CustomEvent<boolean>).detail); };
    window.addEventListener('presensi-automasi-updated', onUpd);
    window.addEventListener('presensi-preset-updated', onUpd);
    window.addEventListener('presensi-scheduler-toggle', onToggle as any);
    return () => {
      window.removeEventListener('presensi-automasi-updated', onUpd);
      window.removeEventListener('presensi-preset-updated', onUpd);
      window.removeEventListener('presensi-scheduler-toggle', onToggle as any);
    };
  }, [loadAll]);

  const toggleGlobal = () => {
    const next = !globalScheduler;
    setGlobalScheduler(next);
    setPenjadwalAktifStorage(next);
  };

  const testNotif = async () => {
    setTestingNotif(true);
    setNotifMsg(null);
    try {
      await kirimNotifikasiNative('TETUKO - Tes Notifikasi', 'Notifikasi preset/automasi berfungsi.');
      setNotifMsg('Permintaan notifikasi terkirim. Cek notifikasi sistem/browser.');
    } catch (e: any) {
      setNotifMsg(`Gagal: ${e?.message || e}`);
    } finally {
      setTestingNotif(false);
    }
  };

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusyKey(key);
    try { await fn(); await loadAll(); }
    finally { setBusyKey(curr => curr === key ? null : curr); }
  };

  const openUnifiedModal = async (profileId: ServerProfileId, username: string, preset: PresetOtomatisasi | null) => {
    if (!username) return;
    try {
      const [locs, stock] = await Promise.all([
        bacaTitik(username).catch(() => [] as TitikAbsen[]),
        bacaSemuaStockFoto().catch(() => [] as StockFoto[]),
      ]);
      setFormLocations(locs);
      setFormStockUnified(stock);
      setUnifiedEdit({ profileId, username, preset });
    } catch {
      setFormLocations([]);
      setFormStockUnified([]);
      setUnifiedEdit({ profileId, username, preset });
    }
  };

  const openLegacyModal = async (username: string, preset: PresetAutomasi | null) => {
    if (!username) return;
    try {
      const stock = await bacaSemuaStockFotoLegacy().catch(() => [] as StockFotoLegacy[]);
      setFormStockLegacy(stock);
      setLegacyEdit({ username, preset });
    } catch {
      setFormStockLegacy([]);
      setLegacyEdit({ username, preset });
    }
  };

  const saveUnified = async (data: Omit<PresetOtomatisasi, 'id' | 'dibuatPada' | 'diperbarui'>) => {
    if (!unifiedEdit) return;
    const { profileId, username, preset } = unifiedEdit;
    if (preset) await perbaruiPresetUnified(username, preset.id, data, profileId);
    else await tambahPresetUnified(username, data, profileId);
    try { window.dispatchEvent(new CustomEvent('presensi-automasi-updated')); } catch {}
    setUnifiedEdit(null);
    await loadAll();
  };

  const saveLegacy = async (data: Omit<PresetAutomasi, 'id' | 'dibuatPada' | 'diperbarui'>) => {
    if (!legacyEdit) return;
    const { username, preset } = legacyEdit;
    if (preset) await perbaruiPresetLegacy(username, preset.id, data);
    else await tambahPresetLegacy(username, data);
    try { window.dispatchEvent(new CustomEvent('presensi-preset-updated')); } catch {}
    setLegacyEdit(null);
    await loadAll();
  };

  const onTambahFotoUnified = async (data: Omit<StockFoto, 'id' | 'dibuatPada'>) => {
    const foto = await tambahStockFotoUnified(data);
    setFormStockUnified(await bacaSemuaStockFoto().catch(() => []));
    return foto;
  };
  const onHapusFotoUnified = async (id: string) => {
    await hapusStockFotoUnified(id);
    setFormStockUnified(await bacaSemuaStockFoto().catch(() => []));
  };
  const onTambahFotoLegacy = async (data: Omit<StockFotoLegacy, 'id' | 'dibuatPada'>) => {
    const foto = await tambahStockFotoLegacy(data);
    setFormStockLegacy(await bacaSemuaStockFotoLegacy().catch(() => []));
    return foto;
  };
  const onHapusFotoLegacy = async (id: string) => {
    await hapusStockFotoLegacy(id);
    setFormStockLegacy(await bacaSemuaStockFotoLegacy().catch(() => []));
  };

  const now = useMemo(() => new Date(nowTick), [nowTick]);
  const unifiedEditProfile = unifiedEdit ? getServerProfile(unifiedEdit.profileId) : null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/40 p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Manajemen Preset</h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Jatim, Madiun, Ponorogo (tambah/edit/hapus/on-off, tes notifikasi, hitung mundur).</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={toggleGlobal} className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold border transition-colors ${globalScheduler ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700' : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
              {globalScheduler ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
              Penjadwal: {globalScheduler ? 'ON' : 'OFF'}
            </button>
            <button type="button" onClick={() => void testNotif()} disabled={testingNotif} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white">
              {testingNotif ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />} Tes Notifikasi
            </button>
            <button type="button" onClick={() => void loadAll()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Muat Ulang
            </button>
          </div>
        </div>
        {notifMsg && <div className="rounded-xl border border-blue-200 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-950/20 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">{notifMsg}</div>}
        <div className="text-[11px] text-slate-500 dark:text-slate-400">Acuan: <span className="font-semibold text-slate-700 dark:text-slate-200">{getNowWIBTime(now)} WIB</span> · {getTodayWIB(now)}</div>
      </div>

      {loading && entries.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center text-sm text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Memuat preset...</div>
      ) : entries.map((entry) => {
        const total = entry.unified.length + entry.legacy.length;
        const prof = getServerProfile(entry.profileId);
        return (
          <div key={entry.profileId} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 bg-slate-50/60 dark:bg-slate-800/30">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{entry.profileName}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-200/70 dark:bg-slate-700 text-slate-600 dark:text-slate-300">{entry.label}</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-800/40">{total} preset</span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Akun: {entry.username ? <span className="font-semibold text-slate-700 dark:text-slate-200">{entry.username}</span> : <span className="text-amber-600 dark:text-amber-400">belum tersimpan</span>}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={!entry.username}
                  onClick={() => void openUnifiedModal(entry.profileId, entry.username, null)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" /> Tambah
                </button>
                {prof.mode === 'ponorogo-absensi' && (
                  <button
                    type="button"
                    disabled={!entry.username}
                    onClick={() => void openLegacyModal(entry.username, null)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 disabled:opacity-50"
                  >
                    <Plus className="w-3.5 h-3.5" /> Tambah Legacy
                  </button>
                )}
              </div>
            </div>

            <div className="p-4 space-y-3">
              {entry.error && <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{entry.error}</span></div>}
              {total === 0 && !entry.error && <div className="text-xs text-slate-500 dark:text-slate-400">Belum ada preset.</div>}

              {entry.unified.map((preset) => {
                const log = entry.unifiedLogs.find(l => l.presetId === preset.id);
                const next = nextUnifiedTrigger(preset, now);
                const done = log?.berhasil;
                const kToggle = `u:${entry.profileId}:${entry.username}:${preset.id}:toggle`;
                const kDel = `u:${entry.profileId}:${entry.username}:${preset.id}:del`;
                return (
                  <div key={`u-${preset.id}`} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{preset.nama}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${preset.aktif ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'}`}>{preset.aktif ? 'Aktif' : 'Nonaktif'}</span>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase">{preset.tipe}</span>
                          {done && <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40"><CheckCircle2 className="w-3 h-3" /> Sukses</span>}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                          <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {preset.jamMulai}-{preset.jamSelesai}</span>
                          <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {(preset.lokasiIds||[]).length}</span>
                          {(preset.stockFotoIds||[]).length > 0 && <span className="inline-flex items-center gap-1"><Camera className="w-3.5 h-3.5" /> {(preset.stockFotoIds||[]).length}</span>}
                          {preset.workcodeId ? <span>WC: {preset.workcodeId}</span> : null}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button type="button" disabled={!!busyKey} onClick={() => void openUnifiedModal(entry.profileId, entry.username, preset)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"><Pencil className="w-3.5 h-3.5" /> Edit</button>
                        <button type="button" disabled={!!busyKey} onClick={() => void act(kToggle, async () => { await toggleAktifPreset(entry.username, preset.id, entry.profileId); try { window.dispatchEvent(new CustomEvent('presensi-automasi-updated')); } catch {} })} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold border ${preset.aktif ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/40' : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/40'} disabled:opacity-50`}>{busyKey === kToggle ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : preset.aktif ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />} {preset.aktif ? 'Off' : 'On'}</button>
                        <button type="button" disabled={!!busyKey} onClick={() => { if (!confirm(`Hapus preset \"${preset.nama}\"?`)) return; void act(kDel, async () => { await hapusPreset(entry.username, preset.id, entry.profileId); try { window.dispatchEvent(new CustomEvent('presensi-automasi-updated')); } catch {} }); }} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300 disabled:opacity-50">{busyKey === kDel ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Hapus</button>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5 text-slate-400" /><HariBadges hariAktif={preset.hariAktif as number[]} labelMap={LABEL_HARI as any} /></div>
                    <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/70 px-3 py-2 text-[11px] text-slate-600 dark:text-slate-300 flex flex-wrap items-center justify-between gap-2">
                      <span>{next.label}</span>
                      {next.ms !== null && <span className={`font-bold ${next.ms <= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400'}`}>{formatCountdown(next.ms)}</span>}
                    </div>
                    {log && <div className="text-[11px] text-slate-500 dark:text-slate-400">Log: {log.berhasil ? 'Berhasil' : 'Gagal'}{log.pesan ? ` - ${log.pesan}` : ''}</div>}
                  </div>
                );
              })}

              {entry.legacy.map((preset) => {
                const log = entry.legacyLogs.find(l => l.presetId === preset.id);
                const next = nextLegacyTrigger(preset, now);
                const done = log?.berhasil;
                const kToggle = `l:${entry.profileId}:${entry.username}:${preset.id}:toggle`;
                const kDel = `l:${entry.profileId}:${entry.username}:${preset.id}:del`;
                return (
                  <div key={`l-${preset.id}`} className="rounded-xl border border-amber-200/70 dark:border-amber-800/40 p-3 space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{preset.nama}</span>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300">Legacy</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${preset.aktif ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'}`}>{preset.aktif ? 'Aktif' : 'Nonaktif'}</span>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase">{preset.tipe}</span>
                          {done && <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40"><CheckCircle2 className="w-3 h-3" /> Sukses</span>}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                          <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {preset.jamMulai}-{preset.jamSelesai}</span>
                          <span className="inline-flex items-center gap-1"><Camera className="w-3.5 h-3.5" /> {(preset.stockFotoIds||[]).length}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button type="button" disabled={!!busyKey} onClick={() => void openLegacyModal(entry.username, preset)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"><Pencil className="w-3.5 h-3.5" /> Edit</button>
                        <button type="button" disabled={!!busyKey} onClick={() => void act(kToggle, async () => { await toggleAktifPresetLegacy(entry.username, preset.id); try { window.dispatchEvent(new CustomEvent('presensi-preset-updated')); } catch {} })} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold border ${preset.aktif ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/40' : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/40'} disabled:opacity-50`}>{busyKey === kToggle ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : preset.aktif ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />} {preset.aktif ? 'Off' : 'On'}</button>
                        <button type="button" disabled={!!busyKey} onClick={() => { if (!confirm(`Hapus preset legacy \"${preset.nama}\"?`)) return; void act(kDel, async () => { await hapusPresetLegacy(entry.username, preset.id); try { window.dispatchEvent(new CustomEvent('presensi-preset-updated')); } catch {} }); }} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300 disabled:opacity-50">{busyKey === kDel ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Hapus</button>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5 text-slate-400" /><HariBadges hariAktif={preset.hariAktif as number[]} labelMap={NAMA_HARI_LEGACY as any} /></div>
                    <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/70 px-3 py-2 text-[11px] text-slate-600 dark:text-slate-300 flex flex-wrap items-center justify-between gap-2">
                      <span>{next.label}</span>
                      {next.ms !== null && <span className={`font-bold ${next.ms <= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400'}`}>{formatCountdown(next.ms)}</span>}
                    </div>
                    {log && <div className="text-[11px] text-slate-500 dark:text-slate-400">Log: {log.berhasil ? 'Berhasil' : 'Gagal'}{log.pesan ? ` - ${log.pesan}` : ''}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <PresetFormModal
        buka={!!unifiedEdit}
        onTutup={() => setUnifiedEdit(null)}
        onSimpan={saveUnified}
        preset={unifiedEdit?.preset ?? null}
        lokasiTersimpan={formLocations}
        workcodes={[]}
        requiresWorkCode={unifiedEditProfile?.requiresWorkCode ?? false}
        requiresPhoto={unifiedEditProfile?.requiresPhotoPreset ?? false}
        stockFotos={formStockUnified}
        onTambahFoto={onTambahFotoUnified}
        onHapusFoto={onHapusFotoUnified}
      />

      <PresetAutomasiFormModal
        open={!!legacyEdit}
        preset={legacyEdit?.preset ?? null}
        stockFotos={formStockLegacy as any}
        onSimpan={saveLegacy as any}
        onTambahFoto={onTambahFotoLegacy as any}
        onHapusFoto={onHapusFotoLegacy as any}
        onClose={() => setLegacyEdit(null)}
      />
    </div>
  );
}
