import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, CheckCircle2, Clock, Loader2, MapPin, Power, PowerOff, RefreshCw, Trash2, Zap, AlertTriangle, CalendarDays, Camera, Plus, Pencil, Users } from 'lucide-react';
import { SERVER_PROFILES, getServerProfile, type ServerProfileId } from '../lib/serverProfiles';
import { loadAllServerCreds } from '../lib/loginCredsStore';
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
import { bacaTitik, type TitikAbsen } from '../lib/lokasiTersimpan';
import { getPenjadwalAktifStorage, setPenjadwalAktifStorage } from './GlobalPresetScheduler';
import { kirimNotifikasiNative } from '../lib/notifikasi';
import PresetFormModal from './PresetFormModal';

type AccountEntry = {
  username: string;
  unified: PresetOtomatisasi[];
  unifiedLogs: LogEksekusi[];
  error?: string;
};

type ProfileEntry = {
  profileId: ServerProfileId;
  profileName: string;
  mode: string;
  accounts: AccountEntry[];
};

function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return -1;
  const h = Number(m[1]); const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return -1;
  return h * 60 + mm;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'Siap';
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
    const timePart = (timePartRaw || '00:00:00').slice(0, 5);
    const nowSec = Number((timePartRaw || '00:00:00').slice(6, 8) || '0');
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

function HariBadges({ hariAktif, labelMap }: { hariAktif: number[]; labelMap: Record<number, string> }) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="flex flex-wrap gap-1">
      {order.map((h) => (
        <span key={h} className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${hariAktif.includes(h) ? 'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300' : 'bg-slate-100 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500'}`}>{labelMap[h as any]}</span>
      ))}
    </div>
  );
}

type UnifiedEditState = { profileId: ServerProfileId; username: string; preset: PresetOtomatisasi | null } | null;

export default function ServerHubPresetManager({ accountKey }: { accountKey: string }) {
  const [entries, setEntries] = useState<ProfileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [globalScheduler, setGlobalScheduler] = useState<boolean>(() => getPenjadwalAktifStorage());
  const [testingNotif, setTestingNotif] = useState(false);
  const [notifMsg, setNotifMsg] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [activeProfile, setActiveProfile] = useState<ServerProfileId>('jatim');
  const [activeAccountByProfile, setActiveAccountByProfile] = useState<Record<string, string>>({});

  const [unifiedEdit, setUnifiedEdit] = useState<UnifiedEditState>(null);
  const [formLocations, setFormLocations] = useState<TitikAbsen[]>([]);
  const [formStockUnified, setFormStockUnified] = useState<StockFoto[]>([]);

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const today = getTodayWIB();
      const rows = await Promise.all(SERVER_PROFILES.map(async (p) => {
        const profileId = p.id as ServerProfileId;
        const creds = await loadAllServerCreds(profileId, accountKey).catch(() => [] as any[]);
        const accounts: AccountEntry[] = await Promise.all((creds as any[]).map(async (cred: any) => {
          const username = String(cred?.nip || '').trim();
          if (!username) return { username: '', unified: [], unifiedLogs: [], error: 'Kredensial tidak valid.' } as AccountEntry;
          try {
            const [u, ul] = await Promise.all([
              bacaSemuaPreset(username, profileId).catch(() => [] as PresetOtomatisasi[]),
              bacaLogHarian(username, today, profileId).catch(() => [] as LogEksekusi[]),
            ]);
            return { username, unified: u, unifiedLogs: ul } as AccountEntry;
          } catch (e: any) {
            return { username, unified: [], unifiedLogs: [], error: e?.message || 'Gagal memuat preset.' } as AccountEntry;
          }
        }));
        return { profileId, profileName: p.nama, mode: p.mode, accounts: accounts.filter(a => a.username) } as ProfileEntry;
      }));
      setEntries(rows);
      setActiveAccountByProfile(prev => {
        const next = { ...prev };
        for (const row of rows) {
          const current = next[row.profileId];
          if (!row.accounts.some(a => a.username === current)) {
            next[row.profileId] = row.accounts[0]?.username || '';
          }
        }
        return next;
      });
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
      setNotifMsg('Permintaan notifikasi terkirim.');
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

  const saveUnified = async (data: Omit<PresetOtomatisasi, 'id' | 'dibuatPada' | 'diperbarui'>) => {
    if (!unifiedEdit) return;
    const { profileId, username, preset } = unifiedEdit;
    if (preset) await perbaruiPresetUnified(username, preset.id, data, profileId);
    else await tambahPresetUnified(username, data, profileId);
    try { window.dispatchEvent(new CustomEvent('presensi-automasi-updated')); } catch {}
    setUnifiedEdit(null);
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

  const now = useMemo(() => new Date(nowTick), [nowTick]);
  const unifiedEditProfile = unifiedEdit ? getServerProfile(unifiedEdit.profileId) : null;
  const selectedProfileEntry = entries.find(e => e.profileId === activeProfile) || null;
  const selectedUsername = (selectedProfileEntry && (activeAccountByProfile[selectedProfileEntry.profileId] || selectedProfileEntry.accounts[0]?.username)) || '';
  const selectedAccount = selectedProfileEntry?.accounts.find(a => a.username === selectedUsername) || selectedProfileEntry?.accounts[0] || null;

  return (
    <div className="space-y-3">
      {/* Header kontrol */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-3 sm:p-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Manajemen Preset</h3>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleGlobal}
              className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold border transition-colors ${globalScheduler ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700' : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
              title="Aktif/nonaktif penjadwal preset"
            >
              {globalScheduler ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
              Penjadwal: {globalScheduler ? 'ON' : 'OFF'}
            </button>
            <button
              type="button"
              onClick={() => void testNotif()}
              disabled={testingNotif}
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white transition-colors"
              title="Kirim tes notifikasi"
            >
              {testingNotif ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
              Tes Notifikasi
            </button>
            <button
              type="button"
              onClick={() => void loadAll()}
              disabled={loading}
              className="inline-flex items-center justify-center h-9 w-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 disabled:opacity-60 transition-colors"
              title="Muat ulang preset"
              aria-label="Muat ulang preset"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
          <span>Acuan: <span className="font-semibold text-slate-700 dark:text-slate-200">{getNowWIBTime(now)} WIB</span> · {getTodayWIB(now)}</span>
        </div>
        {notifMsg && <div className="mt-2 rounded-xl border border-blue-200 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-950/20 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">{notifMsg}</div>}
      </div>

      {/* Tab profil terpisah */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 p-1.5 sm:p-2">
          <div className="grid grid-cols-3 gap-1.5">
            {SERVER_PROFILES.map((p) => {
              const e = entries.find(x => x.profileId === p.id);
              const total = (e?.accounts || []).reduce((sum, a) => sum + a.unified.length, 0);
              const accCount = e?.accounts.length || 0;
              const active = activeProfile === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActiveProfile(p.id as ServerProfileId)}
                  className={`relative rounded-xl px-2.5 sm:px-3 py-2 text-left transition-all border ${active ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 shadow-sm' : 'border-transparent hover:bg-white/70 dark:hover:bg-slate-900/50 text-slate-600 dark:text-slate-300'}`}
                >
                  <div className={`text-xs sm:text-[13px] font-bold truncate ${active ? 'text-slate-900 dark:text-slate-100' : 'text-slate-700 dark:text-slate-200'}`}>{p.nama}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${active ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>{accCount} akun</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${active ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300' : 'bg-slate-100/70 dark:bg-slate-800/70 text-slate-500 dark:text-slate-400'}`}>{total} preset</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-3 sm:p-4">
          {loading && entries.length === 0 ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/30 p-6 text-center text-sm text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Memuat preset...
            </div>
          ) : !selectedProfileEntry ? null : selectedProfileEntry.accounts.length === 0 ? (
            <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 px-3 py-3 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Belum ada akun/kredensial tersimpan untuk {selectedProfileEntry.profileName}. Tambahkan melalui login Server di profil ini (simpan & masuk) agar preset per akun dapat dikelola dan disinkronkan ke native.</span>
            </div>
          ) : !selectedAccount ? null : (
            <div className="space-y-3">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <Users className="w-3.5 h-3.5" />
                    <span>Akun ({selectedProfileEntry.accounts.length})</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {selectedProfileEntry.accounts.map((acc) => {
                      const active = acc.username === selectedAccount.username;
                      const total = acc.unified.length;
                      return (
                        <button
                          key={acc.username}
                          type="button"
                          onClick={() => setActiveAccountByProfile(prev => ({ ...prev, [selectedProfileEntry.profileId]: acc.username }))}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                          title={`Kelola preset untuk ${acc.username}`}
                        >
                          <span className="truncate max-w-[140px]">{acc.username}</span>
                          <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${active ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>{total}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={!selectedAccount.username}
                    onClick={() => void openUnifiedModal(selectedProfileEntry.profileId, selectedAccount.username, null)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Tambah Preset
                  </button>

                </div>
              </div>

              {selectedAccount.error && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{selectedAccount.error}</span>
                </div>
              )}

              {!selectedAccount.error && selectedAccount.unified.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/20 px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                  Belum ada preset untuk akun <span className="font-semibold">{selectedAccount.username}</span>.
                </div>
              )}

              <div className="space-y-2.5">
                {selectedAccount.unified.map((preset) => {
                  const log = selectedAccount.unifiedLogs.find(l => l.presetId === preset.id);
                  const next = nextUnifiedTrigger(preset, now);
                  const done = log?.berhasil;
                  const kToggle = `u:${selectedProfileEntry.profileId}:${selectedAccount.username}:${preset.id}:toggle`;
                  const kDel = `u:${selectedProfileEntry.profileId}:${selectedAccount.username}:${preset.id}:del`;
                  return (
                    <div key={`u-${selectedAccount.username}-${preset.id}`} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 p-3 sm:p-3.5 space-y-2.5">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2.5">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{preset.nama}</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${preset.aktif ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'}`}>{preset.aktif ? 'Aktif' : 'Nonaktif'}</span>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase">{preset.tipe}</span>
                            {done && <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40"><CheckCircle2 className="w-3 h-3" /> Sukses</span>}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                            <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {preset.jamMulai}-{preset.jamSelesai}</span>
                            <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {(preset.lokasiIds || []).length} lokasi</span>
                            {(preset.stockFotoIds || []).length > 0 && <span className="inline-flex items-center gap-1"><Camera className="w-3.5 h-3.5" /> {(preset.stockFotoIds || []).length} foto</span>}
                            {preset.workcodeId ? <span>WC: {preset.workcodeId}</span> : null}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          <button type="button" disabled={!!busyKey} onClick={() => void openUnifiedModal(selectedProfileEntry.profileId, selectedAccount.username, preset)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"><Pencil className="w-3.5 h-3.5" /> Edit</button>
                          <button type="button" disabled={!!busyKey} onClick={() => void act(kToggle, async () => { await toggleAktifPreset(selectedAccount.username, preset.id, selectedProfileEntry.profileId); try { window.dispatchEvent(new CustomEvent('presensi-automasi-updated')); } catch {} })} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold border ${preset.aktif ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/40' : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/40'} disabled:opacity-50`}>{busyKey === kToggle ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : preset.aktif ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />} {preset.aktif ? 'Off' : 'On'}</button>
                          <button type="button" disabled={!!busyKey} onClick={() => { if (!confirm(`Hapus preset "${preset.nama}"?`)) return; void act(kDel, async () => { await hapusPreset(selectedAccount.username, preset.id, selectedProfileEntry.profileId); try { window.dispatchEvent(new CustomEvent('presensi-automasi-updated')); } catch {} }); }} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300 disabled:opacity-50">{busyKey === kDel ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Hapus</button>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5 text-slate-400 shrink-0" /><HariBadges hariAktif={preset.hariAktif as number[]} labelMap={LABEL_HARI as any} /></div>
                      <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/70 px-3 py-2 text-[11px] text-slate-600 dark:text-slate-300 flex flex-wrap items-center justify-between gap-2">
                        <span>{next.label}</span>
                        {next.ms !== null && <span className={`font-bold ${next.ms <= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400'}`}>{formatCountdown(next.ms)}</span>}
                      </div>
                      {log && <div className="text-[11px] text-slate-500 dark:text-slate-400">Log: {log.berhasil ? 'Berhasil' : 'Gagal'}{log.pesan ? ` — ${log.pesan}` : ''}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

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

    </div>
  );
}
