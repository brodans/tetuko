import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Building2, CalendarClock, CheckCircle2, CloudDownload, Fingerprint,
  MapPin, RefreshCw, ShieldCheck, Sparkles, UserCircle, XCircle,
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { useServerContext } from '../hooks/useServerContext';
import { ActionButton, Alert, Badge, Card, CardTitle, PageHeader, StatTile } from '../components/ui/Surface';
import { rpcGetLokasiAbsen, rpcHistoryAbsen, rpcSyncData, type HistoryAbsenModel, type LokasiView } from '../lib/apiCalls';
import { getTodayWIB } from '../lib/dateFormatter';
import { isCheckType, jamTampil } from '../lib/viewModels';
import { ABSEN_CHECK_TYPE } from '../lib/presensiContract';
import { apiUrl } from '../lib/apiBase';
import { useResolvedImageSource } from '../hooks/useResolvedImageSource';

function Row({ label, value, mono, icon }: { label: string; value: string; mono?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 shrink-0">{icon}{label}</span>
      <span className={`text-xs font-semibold text-slate-700 dark:text-slate-200 text-right truncate ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function QuickAction({ icon, title, hint, onClick }: { icon: React.ReactNode; title: string; hint: string; onClick: () => void; }) {
  return (
    <button type="button" onClick={onClick} className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-left transition-all hover:border-blue-300 dark:hover:border-blue-500/40 hover:shadow-sm group">
      <div className="w-10 h-10 rounded-xl bg-blue-500/10 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{title}</p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{hint}</p>
      </div>
      <ArrowRight className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all shrink-0" />
    </button>
  );
}

export default function Beranda() {
  const { pegawai, serverProfile, loginForm, setActivePage } = useAppContext();
  const { context, ready } = useServerContext();
  const rawProfilePic = (pegawai as any)?.profilePic || (pegawai as any)?.foto || '';
  const profilePicUrl = rawProfilePic
    ? (String(rawProfilePic).startsWith('data:') || String(rawProfilePic).startsWith('blob:')
      ? String(rawProfilePic)
      : apiUrl(`/api/proxy-image?path=${encodeURIComponent(String(rawProfilePic).startsWith('/') ? String(rawProfilePic) : `/${String(rawProfilePic)}`)}`))
    : '';
  const resolvedProfilePic = useResolvedImageSource(profilePicUrl);
  const [locations, setLocations] = useState<LokasiView[]>([]);
  const [todayPunches, setTodayPunches] = useState<HistoryAbsenModel[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const today = getTodayWIB();

  const loadDashboard = useCallback(async () => {
    if (!ready || !pegawai?.apiKey) return;
    setLoadError(null);
    try {
      const [lokasis, punches] = await Promise.all([
        rpcGetLokasiAbsen(context),
        rpcHistoryAbsen(context, { tgl: today, page: 1, limit: 20 }),
      ]);
      setLocations(Array.isArray(lokasis) ? lokasis : []);
      setTodayPunches(Array.isArray(punches) ? punches : []);
    } catch (err: any) {
      setLoadError(err?.message ?? 'Gagal memuat data dari server pusat.');
    }
  }, [context, pegawai?.apiKey, ready, today]);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  const punchMasuk = todayPunches.find(row => isCheckType(row.checktype, ABSEN_CHECK_TYPE.DATANG));
  const punchPulang = todayPunches.find(row => isCheckType(row.checktype, ABSEN_CHECK_TYPE.PULANG));
  const jamMasukAktif = jamTampil(punchMasuk?.waktu);
  const jamPulangAktif = jamTampil(punchPulang?.waktu);
  const lokasiAktif = (locations[0] as any) ?? null;

  const handleSyncData = async () => {
    if (!ready) return;
    setSyncing(true);
    try {
      await rpcSyncData(context);
      await loadDashboard();
    } catch (err: any) {
      setLoadError(err?.message ?? 'Sinkronisasi gagal.');
    } finally {
      setSyncing(false);
    }
  };

  const namaDepan = useMemo(() => (pegawai?.nama || 'Pegawai').split(' ')[0], [pegawai?.nama]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Halo, ${namaDepan}`}
        subtitle={`${serverProfile.nama} · ${pegawai?.departemen || serverProfile.label}`}
        icon={<Sparkles className="w-5 h-5" />}
        action={
          <>
            <ActionButton variant="ghost" size="sm" loading={syncing} onClick={() => void handleSyncData()} icon={<CloudDownload className="w-4 h-4" />} aria-label="Sinkronkan data" title="Sinkronkan data" className="!p-2 sm:!px-3 sm:!py-1.5"><span className="hidden sm:inline">Sync Data</span></ActionButton>
            <ActionButton variant="secondary" size="sm" onClick={() => void loadDashboard()} icon={<RefreshCw className="w-4 h-4" />} aria-label="Muat ulang beranda" title="Muat ulang" className="!p-2 sm:!px-3 sm:!py-1.5"><span className="hidden sm:inline">Muat Ulang</span></ActionButton>
          </>
        }
      />

      {loadError && <Alert tone="rose">{loadError}</Alert>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile
          label="Status Hari Ini"
          value={jamMasukAktif ? 'Hadir' : 'Belum Absen'}
          hint={jamMasukAktif ? `Masuk ${jamMasukAktif}` : todayPunches.length > 0 ? `${todayPunches.length} rekaman absen` : 'Belum ada catatan'}
          tone={jamMasukAktif ? 'emerald' : 'amber'}
          icon={jamMasukAktif ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
        />
        <StatTile label="Jam Masuk" value={jamMasukAktif ?? '--:--'} hint="Absen Datang hari ini" tone="blue" icon={<CalendarClock className="w-4 h-4" />} />
        <StatTile label="Jam Pulang" value={jamPulangAktif ?? '--:--'} hint="Absen Pulang hari ini" tone="violet" icon={<CalendarClock className="w-4 h-4" />} />
        <StatTile label="Lokasi Absen" value={lokasiAktif ? 'Terdaftar' : 'Belum'} hint={lokasiAktif ? (lokasiAktif.nama || lokasiAktif.nama_lokasi || 'Lokasi tersedia') : 'Belum terdaftar di server pusat'} tone={lokasiAktif ? 'emerald' : 'slate'} icon={<MapPin className="w-4 h-4" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardTitle>Identitas Presensi</CardTitle>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center shrink-0 overflow-hidden">
              {resolvedProfilePic ? (
                <img src={resolvedProfilePic} alt={pegawai?.nama || 'Profil'} className="w-full h-full object-cover" />
              ) : (
                <UserCircle className="w-8 h-8" />
              )}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-slate-800 dark:text-slate-100 truncate">{pegawai?.nama || '-'}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">{pegawai?.nip || loginForm.username || '-'}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Badge tone="blue">ID {pegawai?.id || '-'}</Badge>
                {punchPulang && <Badge tone="emerald">Sudah absen pulang</Badge>}
              </div>
            </div>
          </div>

          <div className="space-y-2.5 text-sm">
            <Row label="NIP" value={pegawai?.nip || loginForm.username || '-'} mono />
            <Row label="Satuan Kerja" value={pegawai?.departemen || '-'} icon={<Building2 className="w-3.5 h-3.5" />} />
            <Row label="Instansi" value={pegawai?.instansi || lokasiAktif?.nama || lokasiAktif?.nama_lokasi || '-'} />
            <Row label="ID Lokasi" value={String(lokasiAktif?.id || lokasiAktif?.lokasi_id || pegawai?.idLokasi || '-')} mono />
            <Row label="Titik Absen" value={lokasiAktif?.satuanKerja || lokasiAktif?.nama || '-'} />
            <Row label="Rekaman Absen Hari Ini" value={`${todayPunches.length} baris`} />
          </div>
        </Card>

        <Card>
          <CardTitle>Aksi Cepat</CardTitle>
          <div className="space-y-2.5">
            <QuickAction icon={<Fingerprint className="w-5 h-5" />} title="Lakukan Absen" hint="Catat kehadiran hari ini" onClick={() => setActivePage('tabPresensi')} />
            <QuickAction icon={<CalendarClock className="w-5 h-5" />} title="Ajukan Izin" hint="Cuti, sakit, WFH" onClick={() => setActivePage('tabPerizinan')} />
            <QuickAction icon={<ShieldCheck className="w-5 h-5" />} title="Laporan" hint="Rekap presensi" onClick={() => setActivePage('tabLaporan')} />
          </div>

          <div className="mt-5 rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 bg-slate-50/60 dark:bg-slate-800/30 space-y-2 text-xs">
            <div className="flex justify-between gap-3"><span className="text-slate-500">Server</span><span className="font-semibold text-right text-slate-700 dark:text-slate-200">{serverProfile.nama} — {serverProfile.label}</span></div>
            <div className="flex justify-between gap-3"><span className="text-slate-500">Gateway</span><span className="font-mono text-[11px] text-right break-all text-slate-600 dark:text-slate-300">{serverProfile.gatewayUrl}</span></div>
            <div className="flex justify-between gap-3"><span className="text-slate-500">Status</span><Badge tone={pegawai?.apiKey ? 'emerald' : 'amber'}>{pegawai?.apiKey ? 'Terhubung' : 'Belum terhubung'}</Badge></div>
          </div>
        </Card>
      </div>
    </div>
  );
}
