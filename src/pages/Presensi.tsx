import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Camera as CameraIcon,
  Check,
  CheckCircle,
  CheckCircle2,
  Clock,
  Fingerprint,
  Image as ImageIcon,
  Info,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  UploadCloud,
  User,
  X,
  XCircle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAppContext, usePonorogoAppContext } from '../context/AppContext';
import { useServerContext } from '../hooks/useServerContext';
import { useBackButton } from '../hooks/useBackButton';
import { useToast } from '../components/ui/Toast';
import {
  ActionButton,
  Alert,
  Badge,
  Card,
  CardTitle,
  Checkbox,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SkeletonList,
  StatTile,
} from '../components/ui/Surface';
import {
  rpcAbsen,
  rpcGetLokasiAbsen,
  rpcGetWorkCode,
  rpcHistoryAbsen,
  type HistoryAbsenModel,
  type LokasiView,
  type WorkCodeView,
} from '../lib/apiCalls';
import { sendRequest } from '../api';
import { getNowWIBTime, getTodayWIB } from '../lib/dateFormatter';
import { ABSEN_CHECK_TYPE, formatLatLong, TIPE_IJIN_LABEL } from '../lib/presensiContract';
import { checkGeofence } from '../lib/geo';
import { isCheckType, jamTampil, labelCheckType, pilihWorkCodeUntukHari } from '../lib/viewModels';
import PetaAbsen, { type TitikPeta } from '../components/ui/PetaAbsen';
import { bacaTitik, setTitikAktif, type TitikAbsen } from '../lib/lokasiTersimpan';
import Dropdown from '../components/ui/Dropdown';
import { Modal } from '../components/ui/Modal';
import ImageLightbox from '../components/ui/ImageLightbox';
import { usePegawaiSearch } from '../hooks/usePegawaiSearch';
import { loadPegawaiDatabase, toPegawaiSearchList } from '../lib/pegawaiData';
import { loadDataLokasi } from '../data/data_lokasi';
import { isProbablyImageFile, sniffImageKind, decodeImageUniversal, scaleCanvasMaxSide } from '../lib/universalImage';


/**
 * Opsi jenis absensi — nilai `checktype` yang diterima server.
 *
 * Hint pada "Absen Siang" menyebut rentang 12:00–13:00 karena itulah
 * yang server terapkan; panel ini tidak memblokir, hanya memberi informasi.
 */
const CHECK_TYPES = [
  { value: ABSEN_CHECK_TYPE.DATANG, label: 'Absen Datang', hint: 'Absen masuk harian' },
  { value: ABSEN_CHECK_TYPE.PULANG, label: 'Absen Pulang', hint: 'Absen keluar harian' },
  { value: ABSEN_CHECK_TYPE.SIANG, label: 'Absen Siang', hint: 'Umumnya pukul 12:00 – 13:00' },
] as const;

/** Opsi `type_ijin` ketika absensi dikirim bersama pengajuan izin. */
const TIPE_IJIN_OPTIONS = Object.entries(TIPE_IJIN_LABEL);

/**
 * Kalimat saat data Presensi tidak berhasil dimuat karena server pusat.
 *
 * Hulu sesekali membalas badan kosong atau halaman galat HTML — keadaan itu
 * berulang dan mudah terlihat di `getlokasiabsen`. Pada keadaan itu proxy
 * mengirim pesan singkat yang, dibaca sekilas, gampang disalahartikan sebagai
 * masalah akun. Kalimat di sini menegaskan asalnya (server pusat) lebih dulu,
 * lalu menyarankan mencoba lagi — supaya jelas tidak ada yang perlu diperbaiki
 * di akun atau perangkat.
 */
const PESAN_SERVER_PUSAT =
  'Server pusat sedang tidak melayani. Data belum berhasil dimuat — ' +
  'ini gangguan sesaat di sisi server pusat, bukan pada akun atau perangkat ini. ' +
  'Coba lagi beberapa saat lagi.';

/**
 * Apakah galat berasal dari server pusat, bukan dari akun atau perangkat.
 *
 * Dipisah dari pesannya supaya batasnya terbaca: koneksi perangkat terputus
 * (`Koneksi gagal: …`) dan origin ditolak sengaja **tidak** masuk ke sini —
 * penyebab dan saran lanjutannya berbeda, jadi pesannya juga jangan disamakan.
 */
function galatServerPusat(err: unknown): boolean {
  const e = err as { message?: string; huluStatus?: number } | undefined;
  if (!e) return false;
  if (typeof e.huluStatus === 'number' && e.huluStatus >= 502) return true;
  return /server pusat/i.test(e.message ?? '');
}

/** Pesan galat muat data Presensi yang siap ditampilkan. */
function pesanGagalMuat(err: unknown): string {
  if (galatServerPusat(err)) return PESAN_SERVER_PUSAT;
  const pesan = (err as { message?: string } | undefined)?.message?.trim();
  return pesan || 'Gagal memuat data presensi.';
}

function BkdPresensi() {
  const { pegawai, setActivePage, loginForm } = useAppContext();

  const { context, ready, segarkanTitik } = useServerContext();
  // Titik absen milik akun ini saja — bukan satu daftar bersama untuk semua
  // akun yang bergantian di peramban yang sama.
  const username = pegawai?.nip || loginForm.username || '';
  const toast = useToast();

  const [workCodes, setWorkCodes] = useState<WorkCodeView[]>([]);
  const [history, setHistory] = useState<HistoryAbsenModel[]>([]);
  const [locations, setLocations] = useState<LokasiView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Pilihan yang dikirim ke server ───────────────────────────────
  const [workCodeId, setWorkCodeId] = useState('');
  const [checkType, setCheckType] = useState<number>(ABSEN_CHECK_TYPE.DATANG);
  const [isWfh, setIsWfh] = useState(false);
  const [kirimIjin, setKirimIjin] = useState(false);
  const [typeIjin, setTypeIjin] = useState('1');
  const [keterangan, setKeterangan] = useState('');

  // ── Pemilih titik absen (peta) ───────────────────────────────────
  const [titikSaya, setTitikSaya] = useState<TitikAbsen[]>([]);
  const [pilihOpen, setPilihOpen] = useState(false);
  /** Draft koordinat yang sedang digeser di peta. */
  const [drafPeta, setDrafPeta] = useState<{ latitude: number; longitude: number } | null>(null);
  /** Pilihan peta ini hanya berlaku selama halaman Presensi tetap terbuka. */
  const [koordinatSementara, setKoordinatSementara] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  useEffect(() => {
    let aktif = true;
    setTitikSaya([]);
    setKoordinatSementara(null);
    setDrafPeta(null);
    void bacaTitik(username)
      .then(titik => {
        if (aktif) setTitikSaya(titik);
      })
      .catch(() => {
        if (aktif) toast.error('Gagal membaca titik dari penyimpanan perangkat.');
      });
    return () => {
      aktif = false;
    };
  }, [username]);

  // ── Konfirmasi absensi ──────────────────────────────────────────
  const [dialogAbsenOpen, setDialogAbsenOpen] = useState(false);
  const [errorAbsen, setErrorAbsen] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const today = getTodayWIB();

  // ── Muat data ────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setError(null);
    try {
      const [codes, lokasis, riwayat] = await Promise.all([
        rpcGetWorkCode(context),
        rpcGetLokasiAbsen(context),
        rpcHistoryAbsen(context, { tgl: today, page: 1, limit: 30 }),
      ]);
      setWorkCodes(codes);
      setLocations(lokasis);
      setHistory(riwayat);
    } catch (err) {
      setError(pesanGagalMuat(err));
    } finally {
      setLoading(false);
    }
  }, [context, ready, today]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Titik untuk peta: server + milik pengguna + draf.
  const titikPeta: TitikPeta[] = useMemo(() => {
    const server: TitikPeta[] = locations
      .filter(item => item.latitude !== null && item.longitude !== null)
      .map(item => ({
        id: `server-${item.id}`,
        nama: item.nama || item.satuanKerja || item.kode,
        latitude: item.latitude as number,
        longitude: item.longitude as number,
        radius: item.radius,
        dariServer: true,
      }));

    const lokal: TitikPeta[] = titikSaya.map(item => ({
      id: item.id,
      nama: item.nama,
      latitude: item.latitude,
      longitude: item.longitude,
      radius: 100,
      dariServer: false,
      aktif: item.dipakai,
    }));

    const drafTitik: TitikPeta[] = drafPeta
      ? [{
          id: '__draf__',
          nama: 'Posisi baru',
          latitude: drafPeta.latitude,
          longitude: drafPeta.longitude,
          radius: 0,
          dariServer: false,
        }]
      : [];

    return [...server, ...lokal, ...drafTitik];
  }, [locations, titikSaya, drafPeta]);

  // ── Sumber koordinat ─────────────────────────────────────────────
  // Titik yang ditandai "Pakai" di halaman Lokasi Absen menggantikan GPS.
  // Dengan begitu koordinat absen bisa disetel dekat kantor lewat peta tanpa
  // perlu GPS, dan tidak ada permintaan izin lokasi ke peramban sama sekali.
  /*
   * Titik yang sedang dipakai — diturunkan dari `titikSaya`, bukan dibaca
   * ulang dari storage.
   *
   * ⚠️ Semula `useMemo(() => bacaTitikAktif(username), [username])`.
   * Dependensinya cuma `username`, jadi memo **tidak pernah dihitung ulang**
   * saat pengguna mengganti titik dari dropdown atau peta. Akibatnya kartu
   * koordinat, hitungan jarak, dan baris konfirmasi di dialog semuanya
   * masih menampilkan titik yang lama — dan `koordinat` tetap `null` kalau
  * sebelumnya belum ada titik, sehingga tombol "Absen" tetap terkunci
   * padahal titik baru saja dibuat.
   *
   * Diturunkan dari state yang sama dengan isi dropdown, jadi keduanya
   * tidak mungkin berbeda: yang tampil di daftar adalah yang akan dikirim.
   */
  const titikPakai = useMemo(
    () => titikSaya.find(item => item.dipakai) ?? null,
    [titikSaya]
  );
  // Titik server yang dipakai untuk mengecek geofence.
  const activeLocation = useMemo(() => {
    if (locations.length === 0) return null;
    const preferred = locations.find(item => String(item.id) === String(pegawai?.idLokasi ?? ''));
    return preferred ?? locations[0];
  }, [locations, pegawai?.idLokasi]);

  // Koordinat yang benar-benar dikirim.
  //
  // Tidak ada fallback ke GPS: aplikasi ini tidak pernah meminta izin lokasi
  // ke peramban. Kalau belum ada titik yang dipilih, koordinat kosong dan
  // absensi diblokir di UI dengan arahan memilih titik dulu.
  const koordinat = useMemo(
    () =>
      koordinatSementara ??
      (titikPakai
        ? { latitude: titikPakai.latitude, longitude: titikPakai.longitude }
        : null),
    [koordinatSementara, titikPakai]
  );

  // Jarak ke titik server dihitung dari koordinat yang akan dikirim,
  // sehingga angkanya sama dengan yang dilihat server.
  const geofence = useMemo(
    () =>
      checkGeofence(
        koordinat?.latitude ?? null,
        koordinat?.longitude ?? null,
        activeLocation?.latitude,
        activeLocation?.longitude,
        activeLocation?.radius
      ),
    [koordinat, activeLocation]
  );

  // ── Jadwal hari ini ──────────────────────────────────────────────
  const schedule = useMemo(() => pilihWorkCodeUntukHari(workCodes, today), [workCodes, today]);

  // Preselect work code yang cocok dengan hari ini, begitu daftar dimuat.
  useEffect(() => {
    if (workCodeId || !schedule) return;
    setWorkCodeId(String(schedule.id));
  }, [schedule, workCodeId]);

  const selectedWorkCode = useMemo(
    () => workCodes.find(code => String(code.id) === workCodeId) ?? null,
    [workCodes, workCodeId]
  );

  // ── Absensi hari ini ─────────────────────────────────────────────
  // `history_absen` mengembalikan satu baris per rekaman, jadi absen
  // datang/pulang hari ini dibaca dari sana — `cekabsen` hanya
  // hanya untuk satu jenis absensi dan selalu memerlukan work_code.
  const punchMasuk = history.find(row => isCheckType(row.checktype, ABSEN_CHECK_TYPE.DATANG));
  const punchPulang = history.find(row => isCheckType(row.checktype, ABSEN_CHECK_TYPE.PULANG));
  const jamMasukAktif = jamTampil(punchMasuk?.waktu);
  const jamPulangAktif = jamTampil(punchPulang?.waktu);

  // WFH hanya diizinkan hari Jumat.
  const hariWfh =
    new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: 'Asia/Jakarta' })
      .format(new Date(`${today}T00:00:00Z`))
      .toLowerCase() === 'jumat';

  // ── Buka konfirmasi ─────────────────────────────────────────────
  const handleAbsen = () => {
    setError(null);
    setErrorAbsen('');
    if (!workCodeId) {
      setError('Work Code wajib dipilih — server menolak tanpa itu.');
      return;
    }
    if (!koordinat) {
      setError('Koordinat belum dipilih. Pilih titik di peta lebih dulu.');
      return;
    }
    setDialogAbsenOpen(true);
  };

  // ── Kirim absensi ───────────────────────────────────────────────
  const submitAbsen = async () => {
    setError(null);
    setErrorAbsen('');
    if (!workCodeId) {
      setErrorAbsen('Work Code wajib dipilih — server menolak tanpa itu.');
      return;
    }
    if (!koordinat) {
      setErrorAbsen('Koordinat belum dipilih. Pilih titik di peta lebih dulu.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await rpcAbsen({
        ...context,
        lastLatLong: formatLatLong(koordinat.latitude, koordinat.longitude),
      }, {
        checkType,
        workCode: workCodeId,
        isWfh,
        withIjin: kirimIjin,
        keterangan: kirimIjin ? keterangan.trim() : '',
        typeIjin: kirimIjin ? typeIjin : 0,
        // Koordinat selalu dari titik peta, bukan GPS perangkat — jadi
        // tidak pernah berstatus mock location.
        mock: false,
      });

      if (result === null) {
        setErrorAbsen('Server pusat tidak mengembalikan hasil absensi. Coba lagi beberapa saat.');
        return;
      }
      if (result.absen === false) {
        setErrorAbsen(result.message || 'Server menolak absensi ini.');
        return;
      }

      toast.success(`Absen ${labelCheckType(String(checkType))} tercatat pada ${getNowWIBTime().slice(0, 5)} WIB.`);
      setDialogAbsenOpen(false);
      setKeterangan('');
      setKirimIjin(false);
      await loadData();
    } catch (err: any) {
      setErrorAbsen(err?.message ?? 'Gagal mengirim absensi ke server pusat.');
    } finally {
      setSubmitting(false);
    }
  };

  // Tombol kembali menutup dialog konfirmasi lebih dulu.
  useBackButton(
    dialogAbsenOpen,
    () => {
      if (!dialogAbsenOpen) return false;
      setDialogAbsenOpen(false);
      return true;
    }
  );

  if (!ready || !pegawai) {
    return (
      <div className="space-y-6">
        <PageHeader title="Presensi" subtitle="Hubungkan akun ke server pusat terlebih dahulu" icon={<Fingerprint className="w-5 h-5" />} />
        <Card>
          <EmptyState
            message="Belum terhubung ke server pusat."
            hint="Kembali ke Beranda untuk login menggunakan NIP dan password presensi."
          />
          <div className="flex justify-center">
            <ActionButton onClick={() => setActivePage('tabBeranda')} icon={<Fingerprint className="w-4 h-4" />}>
              Ke Beranda
            </ActionButton>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Presensi"
        subtitle={`${pegawai.nama} · ${today}`}
        icon={<Fingerprint className="w-5 h-5" />}
        action={
          <ActionButton variant="ghost" size="sm" onClick={() => void loadData()} icon={<RefreshCw className="w-4 h-4" />} aria-label="Muat ulang presensi" title="Muat ulang presensi" className="!p-2 sm:!px-3 sm:!py-1.5">
            <span className="hidden sm:inline">Muat Ulang</span>
          </ActionButton>
        }
      />

      {error && <Alert tone="rose">{error}</Alert>}

      {/* ── Status ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile
          label="Absen Datang"
          value={jamMasukAktif ?? '--:--'}
          hint={schedule?.jam.jam_masuk ? `Jadwal ${schedule.jam.jam_masuk}` : 'Jadwal belum tersedia'}
          tone={jamMasukAktif ? 'emerald' : 'slate'}
        />
        <StatTile
          label="Absen Pulang"
          value={jamPulangAktif ?? '--:--'}
          hint={schedule?.jam.jam_keluar ? `Jadwal ${schedule.jam.jam_keluar}` : 'Jadwal belum tersedia'}
          tone={jamPulangAktif ? 'emerald' : 'slate'}
        />
        <StatTile
          label="Koordinat Dipakai"
            value={koordinatSementara ? 'Sementara' : titikPakai ? 'Titik Peta' : 'Belum Ada'}
          hint={
            koordinat
              ? `${koordinat.latitude.toFixed(5)}, ${koordinat.longitude.toFixed(5)}`
              : 'Pilih titik di Lokasi Absen'
          }
          tone={koordinat ? 'emerald' : 'rose'}
          icon={<MapPin className="w-4 h-4" />}
        />
        <StatTile
          label="Waktu Sekarang"
          value={getNowWIBTime().slice(0, 5)}
          hint="WIB"
          tone="blue"
          icon={<Clock className="w-4 h-4" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ── Panel aksi ──────────────────────────────────────────── */}
        <Card className="lg:col-span-3">
          <CardTitle>Kirim Absensi</CardTitle>

          <div className="space-y-4">
            {/* ── Koordinat absen ──────────────────────────────────
                Ini yang menggantikan GPS. Titik yang dipilih di sini
                dikirim apa adanya sebagai `last_latlong` ke server saat absen. */}
            <Field label="Koordinat Absen">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <Dropdown
                      value={titikPakai?.id ?? ''}
                      onChange={value => {
                        void setTitikAktif(username, value)
                          .then(() => {
                            setKoordinatSementara(null);
                            setTitikSaya(prev =>
                              prev.map(item => ({ ...item, dipakai: item.id === value }))
                            );
                            segarkanTitik();
                            setDialogAbsenOpen(false);
                          })
                          .catch(() => toast.error('Titik gagal diaktifkan.'));
                      }}
                      opsi={
                        titikSaya.length === 0
                          ? [{ value: '', label: 'Belum ada titik', disabled: true }]
                          : titikSaya.map(item => ({
                              value: item.id,
                              label: item.nama,
                              hint: `${item.latitude.toFixed(5)}, ${item.longitude.toFixed(5)}`,
                            }))
                      }
                      placeholder="— Belum ada titik —"
                      disabled={titikSaya.length === 0}
                      aria-label="Titik absen"
                    />
                  </div>
                  <ActionButton
                    variant="secondary"
                    onClick={() => {
                      const awal =
                        koordinatSementara ??
                        (titikPakai
                          ? { latitude: titikPakai.latitude, longitude: titikPakai.longitude }
                          : activeLocation?.latitude != null && activeLocation.longitude != null
                            ? {
                                latitude: activeLocation.latitude,
                                longitude: activeLocation.longitude,
                              }
                            : null);
                      setDrafPeta(awal);
                      setPilihOpen(true);
                    }}
                    icon={<MapPin className="w-4 h-4" />}
                  >
                    Pilih di Peta
                  </ActionButton>
                </div>
                {koordinatSementara && (
                  <button
                    type="button"
                    onClick={() => setKoordinatSementara(null)}
                    className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    Kembali ke titik tersimpan
                  </button>
                )}

                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500 dark:text-slate-400">Jarak ke titik server</span>
                    <span
                      className={`font-semibold ${
                        geofence.distance === null
                          ? 'text-slate-400 dark:text-slate-500'
                          : geofence.withinRadius
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {geofence.distance === null
                        ? '—'
                        : `${Math.round(geofence.distance).toLocaleString('id-ID')} m`}
                    </span>
                  </div>
                  {koordinat && !geofence.withinRadius && (
                    <p className="text-amber-600 dark:text-amber-400">
                      Di luar radius {geofence.radius} m; keputusan tetap ditentukan server.
                    </p>
                  )}
                </div>
              </div>
            </Field>

            <Field label="Work Code">
              <Dropdown
                value={workCodeId}
                onChange={value => {
                  setWorkCodeId(value);
                  setDialogAbsenOpen(false);
                }}
                opsi={[
                  { value: '', label: '— Pilih work code —', disabled: true },
                  ...workCodes.map(code => {
                    const jam = code.jam;
                    const potong = (v?: string) => (v && v.length >= 5 ? v.slice(0, 5) : '--:--');
                    // Work code EVENT bisa punya batas kosong; tampilkan
                    // "—" daripada "--:--" yang terbaca seperti error.
                    return {
                      value: String(code.id),
                      label: code.nama,
                      hint: `${potong(jam.jam_masuk)} – ${potong(jam.jam_keluar)} · buka ${potong(
                        jam.jam_masuk_awal
                      )} · tutup ${potong(jam.jam_keluar_akhir)}`,
                    };
                  }),
                ]}
                placeholder="— Pilih work code —"
                disabled={workCodes.length === 0}
                searchable
                aria-label="Work code"
              />
            </Field>

            <Field label="Jenis Absensi">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {CHECK_TYPES.map(item => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => {
                      setCheckType(item.value);
                      setDialogAbsenOpen(false);
                    }}
                    className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      checkType === item.value
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="block text-xs font-bold text-slate-800 dark:text-slate-100">{item.label}</span>
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400">{item.hint}</span>
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Mode Kerja">
              <Checkbox
                checked={isWfh}
                disabled={!hariWfh}
                onChange={checked => {
                  setIsWfh(checked);
                  setDialogAbsenOpen(false);
                }}
                label="Absen dari rumah (WFH)"
              />
            </Field>

            <Field label="Serta Pengajuan Izin">
              <Checkbox
                checked={kirimIjin}
                onChange={checked => {
                  setKirimIjin(checked);
                  setDialogAbsenOpen(false);
                }}
                label="Kirim izin bersama absensi ini"
              />
            </Field>

            {kirimIjin && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Tipe Izin" className="sm:col-span-1">
                  <Dropdown
                    value={typeIjin}
                    onChange={value => {
                      setTypeIjin(value);
                      setDialogAbsenOpen(false);
                    }}
                    opsi={TIPE_IJIN_OPTIONS.map(([value, label]) => ({
                      value,
                      label: `${value} — ${label}`,
                    }))}
                    aria-label="Tipe izin"
                  />
                </Field>
                <Field label="Keterangan" className="sm:col-span-2">
                  <Input
                    value={keterangan}
                    onChange={event => setKeterangan(event.target.value.slice(0, 255))}
                    placeholder="Alasan singkat izin hari ini"
                  />
                </Field>
              </div>
            )}

            {!koordinat ? (
              <Alert tone="rose">
                Pilih titik absen di peta sebelum melakukan absensi.
              </Alert>
            ) : false ? (
              <Alert tone="amber">Akun Anda tidak memiliki hak untuk melakukan absensi.</Alert>
            ) : null}

            <div className="space-y-2.5">
              <ActionButton
                block
                size="md"
                // Tiga syarat nyata: hak akses, work code, dan koordinat.
                // Jam TIDAK lagi menjadi syarat.
                disabled={false || !workCodeId || !koordinat}
                onClick={handleAbsen}
                icon={<Fingerprint className="w-5 h-5" />}
              >
                Absen
              </ActionButton>
            </div>
          </div>
        </Card>

        {/* ── Riwayat absensi hari ini ─────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardTitle>Riwayat Absensi Hari Ini</CardTitle>
            {loading ? (
              <SkeletonList rows={4} />
            ) : history.length === 0 ? (
              <EmptyState message="Belum ada riwayat absensi untuk hari ini." />
            ) : (
              <div className="space-y-2">
                {history.map((row, index) => (
                  <div
                    key={`${row.waktu}-${index}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-700 dark:text-slate-200 truncate">
                        {row.nama || pegawai.nama}
                      </p>
                      <p className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
                        {jamTampil(row.waktu) ?? '-'} · {row.jarak || '-'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-mono">
                      <Badge tone={isCheckType(row.checktype, ABSEN_CHECK_TYPE.DATANG) ? 'blue' : 'violet'}>
                        {labelCheckType(row.checktype)}
                      </Badge>
                      {row.approval_text && <Badge tone={row.approval ? 'emerald' : 'amber'}>{row.approval_text}</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ── Dialog konfirmasi ───────────────────────────────────── */}
      {dialogAbsenOpen && (
        <Modal
          open
          onClose={() => setDialogAbsenOpen(false)}
          size="md"
          title={`Konfirmasi ${labelCheckType(String(checkType))}`}
          icon={<ShieldCheck className="w-5 h-5 text-blue-500" />}
          footer={
            <div className="flex justify-end gap-2">
              <ActionButton
                variant="ghost"
                onClick={() => setDialogAbsenOpen(false)}
                icon={<XCircle className="w-4 h-4" />}
              >
                Batal
              </ActionButton>
              <ActionButton
                loading={submitting}
                className="flex-1 min-w-0"
                onClick={() => void submitAbsen()}
                icon={<CheckCircle2 className="w-4 h-4" />}
              >
                Absen
              </ActionButton>
            </div>
          }
        >
          <div className="space-y-4">
              {errorAbsen && <Alert tone="rose">{errorAbsen}</Alert>}

              <div className="space-y-2 text-sm">
                <ConfirmRow label="Waktu" value={`${getNowWIBTime().slice(0, 8)} WIB`} />
                <ConfirmRow label="Work Code" value={selectedWorkCode?.nama ?? '-'} />
                <ConfirmRow label="Tipe" value={labelCheckType(String(checkType))} />
                <ConfirmRow label="Titik Absen" value={titikPakai?.nama ?? '-'} />
                <ConfirmRow
                  label="Koordinat"
                  value={koordinat ? `${koordinat.latitude.toFixed(6)}, ${koordinat.longitude.toFixed(6)}` : '-'}
                />
                <ConfirmRow
                  label="Jarak ke Titik Server"
                  value={geofence.distance !== null ? `${Math.round(geofence.distance).toLocaleString('id-ID')} m` : '-'}
                />
                <ConfirmRow label="WFH" value={isWfh ? 'Ya' : 'Tidak'} />
                {kirimIjin && <ConfirmRow label="Izin" value={TIPE_IJIN_LABEL[typeIjin] ?? typeIjin} />}
              </div>

          </div>
        </Modal>
      )}

      {/* ── Peta pemilih koordinat ─────────────────────────────── */}
      {pilihOpen && (
        <Modal
          open
          onClose={() => {
            setPilihOpen(false);
            setDrafPeta(null);
          }}
          size="lg"
          title="Pilih Titik Absen"
          footer={
            <div className="flex w-full items-center justify-between gap-3">
              <span className="min-w-0 truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                {drafPeta
                  ? `${drafPeta.latitude.toFixed(6)}, ${drafPeta.longitude.toFixed(6)}`
                  : 'Pilih koordinat'}
              </span>
              <div className="flex shrink-0 gap-2">
                <ActionButton
                  variant="ghost"
                  onClick={() => {
                    setPilihOpen(false);
                    setDrafPeta(null);
                  }}
                >
                  Batal
                </ActionButton>
                <ActionButton
                  variant="primary"
                  disabled={!drafPeta}
                  onClick={() => {
                    if (!drafPeta) return;
                    setKoordinatSementara(drafPeta);
                    setDrafPeta(null);
                    setPilihOpen(false);
                    setDialogAbsenOpen(false);
                  }}
                >
                  Gunakan sementara
                </ActionButton>
              </div>
            </div>
          }
        >
          <div className="aspect-square w-full overflow-hidden rounded-xl">
            <PetaAbsen
              titik={titikPeta}
              draggableId={drafPeta ? '__draf__' : null}
              onKlikPeta={koordinat => {
                setDrafPeta(koordinat);
                setDialogAbsenOpen(false);
              }}
              onGeser={(_id, koordinat) => setDrafPeta(koordinat)}
              fokus={drafPeta}
              height="100%"
            />
          </div>
        </Modal>
      )}

    </div>
  );
}

function ConfirmRow({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'rose' }) {
  const color =
    tone === 'emerald'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'rose'
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-slate-700 dark:text-slate-200';
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`text-xs font-semibold text-right truncate ${color}`}>{value}</span>
    </div>
  );
}

// Helper function to find matching location in dataLokasi
function findMatchingLocation(pegawai: any, locations: any[]) {
  if (!pegawai) return null;

  const pNamaLokasi = (pegawai.nama_lokasi || '').toLowerCase().trim();
  const pUnor = (pegawai.unor || '').toLowerCase().trim();
  const pInstansi = (pegawai.instansi || '').toLowerCase().trim();
  const pKodeInstansi = (pegawai.kode_instansi || '').trim();

  // 1. Match by exact id if pegawai has id_lokasi
  if (pegawai.id_lokasi) {
    const found = locations.find(l => l.id === pegawai.id_lokasi);
    if (found) return found;
  }

  // 2. Exact match on normalized nama_lokasi
  if (pNamaLokasi) {
    const found = locations.find(l => (l.nama || '').toLowerCase().trim() === pNamaLokasi);
    if (found) return found;
  }

  // 3. Exact match on normalized unor/instansi
  if (pUnor) {
    const found = locations.find(l => (l.nama || '').toLowerCase().trim() === pUnor);
    if (found) return found;
  }
  if (pInstansi) {
    const found = locations.find(l => (l.nama || '').toLowerCase().trim() === pInstansi);
    if (found) return found;
  }

  // 4. Substring match on nama_lokasi
  if (pNamaLokasi) {
    const found = locations.find(l => {
      const lNama = (l.nama || '').toLowerCase();
      return lNama.includes(pNamaLokasi) || pNamaLokasi.includes(lNama);
    });
    if (found) return found;
  }

  // 5. Substring match on unor/instansi
  if (pUnor) {
    const found = locations.find(l => {
      const lNama = (l.nama || '').toLowerCase();
      return lNama.includes(pUnor) || pUnor.includes(lNama);
    });
    if (found) return found;
  }

  // 6. Match by kode
  if (pKodeInstansi) {
    const found = locations.find(l => l.kode === pKodeInstansi);
    if (found) return found;
  }

  // Fallback: return first location with valid coordinates or null
  return locations.find(l => l.latitude && l.longitude) || null;
}

const getTargetEmployeeId = (employee: any, fallbackId = ''): string => {
  const id = employee?.id_pegawai || employee?.id || fallbackId;
  return id == null ? '' : String(id);
};

function PonorogoPresensiPage() {
  const { pegawai, config, userRole, tabPermissions } = usePonorogoAppContext();
  const [tanggal, _setTanggal] = useState(() => getTodayWIB());
  const [displayTanggal, setDisplayTanggal] = useState('');
  const [timeStr, setTimeStr] = useState(() => {
    const now = new Date();
    return now.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false }) + ' WIB';
  });
  const [fileInfo, setFileInfo] = useState('');
  const [base64Image, setBase64Image] = useState('');
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<{ type: 'success'|'error', text: string } | null>(null);
  const [modalImg, setModalImg] = useState<{ src: string, title: string } | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  // ── Jam Kerja & Status Absen state ──────────────────────────────────────────
  const [jamKerja, setJamKerja] = useState<any>(null);
  const [loadingJamKerja, setLoadingJamKerja] = useState(false);
  const [cekAbsen, setCekAbsen] = useState<any>(null);
  const [loadingCekAbsen, setLoadingCekAbsen] = useState(false);
  // Detail presensi terakhir dari response absen_mobile
  const [presensiDetail, setPresensiDetail] = useState<any>(null);

  const [pegawaiList, setPegawaiList] = useState<any[]>([]);
  const [loadingPegawai, setLoadingPegawai] = useState(false);
  const [pegawaiLoadError, setPegawaiLoadError] = useState(false);
  const [pegawaiLoadAttempt, setPegawaiLoadAttempt] = useState(0);
  const [dataLokasi, setDataLokasi] = useState<any[]>([]);

  useEffect(() => {
    let active = true;
    loadDataLokasi().then((rows) => { if (active) setDataLokasi(Array.isArray(rows) ? rows : []); }).catch(() => { if (active) setDataLokasi([]); });
    return () => { active = false; };
  }, []);
  const {
    searchPegawai,
    setSearchPegawai,
    showPegawaiDropdown,
    setShowPegawaiDropdown,
    selectedPegawai: selectedTargetPegawai,
    setSelectedPegawai: setSelectedTargetPegawai,
    pegawaiDropdownRef: dropdownRef,
    filteredPegawai,
  } = usePegawaiSearch(pegawaiList, { maxResults: 50, showAllWhenEmpty: false });
  const [selectedTargetLocation, setSelectedTargetLocation] = useState<any>(null); // Matched location from dataLokasi
  const canSearchPegawai = userRole === 'admin' || (tabPermissions.allowSearchPegawai ?? false);

  // Camera state
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Hook up back button to close lightbox
  useBackButton(() => {
    setModalImg(null);
    return true;
  }, !!modalImg);

  // Hook up back button to stop camera
  useBackButton(() => {
    stopCamera();
    return true;
  }, isCameraActive);

  // Hook up back button to close confirm modal
  useBackButton(() => {
    setIsConfirmOpen(false);
    return true;
  }, isConfirmOpen);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (tanggal) {
      const [year, month, day] = tanggal.split('-').map(Number);
      const d = new Date(year, month - 1, day);
      const options: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      setDisplayTanggal(d.toLocaleDateString('id-ID', options));
    }
  }, [tanggal]);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false }) + ' WIB');
    };
    tick(); // run once immediately
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  // Cleanup camera when component unmounts
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // ── Fetch jam kerja + status absen saat pegawai/target berubah ──────────────
  const fetchInfoPresensi = useCallback(async (idPegawai: string) => {
    if (!idPegawai) return;

    // Ambil semua dari getJamKerjaPegawai karena sudah mengandung:
    // jam_mulai_scan_masuk, jam_akhir_scan_masuk, jam_mulai_scan_pulang,
    // jam_akhir_scan_pulang, jadwal_pulang, absen_masuk, absen_pulang, jam_kerja
    setLoadingJamKerja(true);
    setLoadingCekAbsen(true);
    try {
      const res: any = await sendRequest('/pegawai/getJamKerjaPegawai', { id_pegawai: idPegawai });
      let jamObj: any = null;

      if (Array.isArray(res))                              jamObj = res[0] ?? null;
      else if (Array.isArray(res?.data))                   jamObj = res.data[0] ?? null;
      else if (res?.data && typeof res.data === 'object')  jamObj = res.data;
      else if (res?.jam_mulai_scan_masuk || res?.jam_kerja || res?.id_pegawai) jamObj = res;
      else if (res && Object.keys(res).length > 2)         jamObj = res;

      setJamKerja(jamObj);

      // ── Derive status absen dari field absen_masuk / absen_pulang di jamKerja ──
      // Field ini berisi datetime string kalau sudah absen, null kalau belum
      if (jamObj) {
        const hasAbsenMasuk  = jamObj.absen_masuk  != null && jamObj.absen_masuk  !== '' && jamObj.absen_masuk  !== 'null';
        const hasAbsenPulang = jamObj.absen_pulang != null && jamObj.absen_pulang !== '' && jamObj.absen_pulang !== 'null';

        // Extract jam HH:mm dari datetime string "2026-09-21 07:34:14.132032"
        const extractJam = (dt: string | null): string | null => {
          if (!dt) return null;
          // Format datetime: "2026-09-21 07:34:14" — ambil jam setelah spasi/T
          const dtMatch = String(dt).match(/\d{4}-\d{2}-\d{2}[T ](\d{2}:\d{2})/);
          if (dtMatch) return dtMatch[1];
          // Format time only: "07:34"
          const tMatch = String(dt).match(/^(\d{2}:\d{2})/);
          return tMatch ? tMatch[1] : null;
        };

        setCekAbsen({
          absen_masuk:  hasAbsenMasuk,
          absen_pulang: hasAbsenPulang,
          jam_masuk:    hasAbsenMasuk  ? extractJam(jamObj.absen_masuk)  : null,
          jam_pulang:   hasAbsenPulang ? extractJam(jamObj.absen_pulang) : null,
          ijin_cuti:    jamObj.ijin_cuti ?? null,
          ada_roster:   jamObj.ada_roster ?? null,
          // jadwal mendahului = sebelum jam_mulai_scan_pulang
          jadwal_pulang: jamObj.jadwal_pulang || null,
        });
      } else {
        // Fallback ke cek_absen endpoint
        try {
          const r2 = await sendRequest('/Tupoksi/cek_absen', { id_pegawai: idPegawai });
          if (r2) {
            const normBool = (v: any) => {
              if (v == null || v === '' || v === 'null') return false;
              if (typeof v === 'boolean') return v;
              if (typeof v === 'number') return v !== 0;
              const s = String(v).toLowerCase();
              return s !== '0' && s !== 'false';
            };
            let o: any = Array.isArray(r2) ? r2[0] : (r2.data || r2);
            if (o) setCekAbsen({
              absen_masuk:  normBool(o.absen_masuk),
              absen_pulang: normBool(o.absen_pulang),
              jam_masuk:  o.jam_masuk  || null,
              jam_pulang: o.jam_pulang || null,
            });
          }
        } catch { /* silent */ }
      }
    } catch {
      setJamKerja(null);
      setCekAbsen(null);
    } finally {
      setLoadingJamKerja(false);
      setLoadingCekAbsen(false);
    }
  }, []);

  // Panggil saat mount atau saat pegawai target berubah
  useEffect(() => {
    const targetId = getTargetEmployeeId(selectedTargetPegawai || pegawai, config.idPegawai);
    if (targetId) fetchInfoPresensi(targetId);
    // Reset detail presensi sebelumnya saat ganti target
    setPresensiDetail(null);
    setOutput(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.idPegawai, selectedTargetPegawai, pegawai?.id, (pegawai as any)?.id_pegawai]);

  // Load the large employee database only when this user can search it.
  useEffect(() => {
    if (!canSearchPegawai || pegawaiList.length > 0) return;
    let cancelled = false;
    setLoadingPegawai(true);
    setPegawaiLoadError(false);
    loadPegawaiDatabase()
      .then(records => { if (!cancelled) setPegawaiList(toPegawaiSearchList(records)); })
      .catch(error => {
        if (!cancelled) {
          console.error('Error loading employee search list:', error);
          setPegawaiLoadError(true);
        }
      })
      .finally(() => { if (!cancelled) setLoadingPegawai(false); });
    return () => { cancelled = true; };
  }, [canSearchPegawai, pegawaiList.length, pegawaiLoadAttempt]);

  const handleSelectPegawai = (p: any) => {
    setSearchPegawai(`${p.nama} (${p.nip})`);
    setShowPegawaiDropdown(false);
    
    // Find full profile from database
    loadPegawaiDatabase().then(fullDb => {
      const fullUser = fullDb.find((item: any) => item.id === p.id || item.nip === p.nip);
      if (!fullUser) return;
      setSelectedTargetPegawai(fullUser);
      setSelectedTargetLocation(findMatchingLocation(fullUser, dataLokasi));
    });
  };

  const handleClearSelection = () => {
    setSearchPegawai('');
    setSelectedTargetPegawai(null);
    setSelectedTargetLocation(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (file) processFile(file);
  };

  // ── Kompresi foto presensi (meniru APK asli bkpsdm_presensi_ponorogo) ──────
  // Decode semua format gambar, normalisasi orientasi pada piksel, lalu kecilkan
  // ke 320 px. Metadata sumber tidak dibaca atau disalin ke JPEG upload.
  const PRESENSI_LONG_SIDE = 320;

/** Race a promise against a timeout — prevents infinite loading if invoke/network hangs. */
function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMsg: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(timeoutMsg)), ms),
    ),
  ]);
}

  const encodePresensi = (canvas: HTMLCanvasElement) => {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    if (dataUrl.length < 100) {
      // "data:," → encoder kanvas gagal.
      setFileInfo('❌ Gagal memproses foto.');
      return;
    }
    const byteLength = Math.round((dataUrl.length * 3) / 4);
    setBase64Image(dataUrl);
    setFileInfo(`${canvas.width}×${canvas.height} px · ${(byteLength / 1024).toFixed(1)} KB`);
  };

  const processFile = (file: File) => {
    setFileInfo('🔄 Memproses & kompresi foto...');
    setBase64Image('');
    setOutput(null);

    void (async () => {
      try {
        const kind = await sniffImageKind(file);
        if (kind === 'unknown' && !isProbablyImageFile(file)) {
          setFileInfo('❌ File gambar tidak dikenali.');
          return;
        }
        const source = await withTimeout(
          decodeImageUniversal(file, kind),
          45_000,
          'Pemrosesan foto terlalu lama. Coba foto dengan ukuran lebih kecil atau format JPEG/PNG.',
        );
        const srcW = source.width, srcH = source.height;
        if (!srcW || !srcH) {
          setFileInfo('❌ Gagal memproses foto.');
          return;
        }
        const canvas = scaleCanvasMaxSide(source, PRESENSI_LONG_SIDE).canvas;
        encodePresensi(canvas);
      } catch (err: any) {
        console.error('Gagal memproses foto:', err);
        setFileInfo(`❌ ${err?.message || 'Foto tidak bisa dibaca.'}`);
      }
    })();
  };

  const userAgent = navigator.userAgent || '';
  const isMobile = /webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent)
    || (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const startCamera = async () => {
    if (isMobile) {
      cameraInputRef.current?.click();
      return;
    }
    
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user' }
      });
      streamRef.current = mediaStream;
      setIsCameraActive(true);
      
      // We need a slight delay to ensure the video element is rendered
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.play().catch(console.error);
        }
      }, 100);
    } catch (err) {
      alert("Tidak dapat mengakses kamera. Pastikan izin kamera telah diberikan.");
      console.error(err);
    }
  };

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  }, []);

  const capturePhoto = () => {
    if (!videoRef.current) return;

    const srcW = videoRef.current.videoWidth  || videoRef.current.offsetWidth;
    const srcH = videoRef.current.videoHeight || videoRef.current.offsetHeight;
    if (!srcW || !srcH) return;

    // Ambil frame video APA ADANYA (resolusi native, tanpa crop), lalu serahkan
    // ke processFile yang akan memperkecil sambil mempertahankan rasio aspek —
    // sama seperti kamera asli yang menyerahkan JPEG mentah ke kompresor.
    const canvas = document.createElement('canvas');
    canvas.width  = srcW;
    canvas.height = srcH;
    const cx = canvas.getContext('2d');
    if (cx) {
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(videoRef.current, 0, 0, srcW, srcH);
    }

    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' });
        processFile(file);
        stopCamera();
      }
    }, 'image/jpeg', 0.95);
  };

  const submitAbsen = async () => {
    if (!base64Image) return;
    
    setLoading(true);
    setOutput(null);
    
    const targetPegawai = selectedTargetPegawai || pegawai;
    const pickCoord = (...vals: any[]) => {
      for (const v of vals) {
        if (v === null || v === undefined) continue;
        const s = String(v).trim();
        if (s !== '' && s !== '0') return s;
      }
      return '';
    };
    const finalIdLokasi = selectedTargetPegawai
      ? (selectedTargetPegawai.id_lokasi || selectedTargetLocation?.id || config.idLokasi || '')
      : config.idLokasi;
    const lokasiById = finalIdLokasi ? dataLokasi.find((l: any) => String(l?.id || '') === String(finalIdLokasi)) : null;
    const finalLat = pickCoord(
      selectedTargetPegawai?.latitude, selectedTargetPegawai?.lat, selectedTargetPegawai?.lattitude,
      selectedTargetLocation?.latitude, selectedTargetLocation?.lat,
      lokasiById?.latitude, lokasiById?.lat,
      config.latitude
    );
    const finalLng = pickCoord(
      selectedTargetPegawai?.longitude, selectedTargetPegawai?.long, selectedTargetPegawai?.lng, selectedTargetPegawai?.lon,
      selectedTargetLocation?.longitude, selectedTargetLocation?.long, selectedTargetLocation?.lng, selectedTargetLocation?.lon,
      lokasiById?.longitude, lokasiById?.long, lokasiById?.lng, lokasiById?.lon,
      config.longitude
    );
    const targetDeviceId = selectedTargetPegawai
      ? (selectedTargetPegawai.emei || selectedTargetPegawai.imei || selectedTargetPegawai.device_id || selectedTargetPegawai.sim_serial || '')
      : config.deviceId;
    const comma = base64Image.indexOf(',');
    const lampiran = comma >= 0 ? base64Image.slice(comma + 1) : base64Image;
    if (!lampiran) {
      setLoading(false);
      setOutput({ type: 'error', text: '❌ Foto tidak valid. Pilih ulang foto sebelum mengirim.' });
      return;
    }

    const payload = {
      tanggal: tanggal,
      keterangan: "Presensi Reguler",
      lampiran,
      sim_serial: targetDeviceId,
      lattitude: finalLat,
      longitude: finalLng,
      imei: targetDeviceId,
      kode_instansi: selectedTargetPegawai ? (selectedTargetPegawai.kode_instansi || '') : config.kodeInstansi,
      kode_unor: selectedTargetPegawai ? (selectedTargetPegawai.kode_unor || selectedTargetPegawai.unor || '') : config.kodeUnor,
      id_lokasi: finalIdLokasi,
      work_mode: config.workMode,
      id_pegawai: getTargetEmployeeId(targetPegawai, config.idPegawai),
      nip: targetPegawai?.nip || '',
      bedgenumber: selectedTargetPegawai ? (selectedTargetPegawai.badgenumber || targetDeviceId) : config.deviceId,
      versi: config.versi
    };

    try {
      const data = await withTimeout(
        sendRequest("/login/absen_mobile", payload),
        60_000,
        'Server tidak merespons dalam 60 detik. Periksa koneksi internet dan coba lagi.',
      );
      
      if (data.success) {
        // ── Urai field detail dari response ─────────────────────────────
        setPresensiDetail({
          status_absen: data.status_absen || data.keterangan || null,
          jam_masuk:    data.jam_masuk    || data.waktu_masuk    || null,
          jam_pulang:   data.jam_pulang   || data.waktu_pulang   || null,
          ada_shift:    data.ada_shift    ?? null,
          belum_verifikasi: data.belum_verifikasi ?? null,
          message:      data.message     || null,
        });
        setOutput({ type: 'success', text: `✅ PRESENSI BERHASIL!\n${data.message || 'Sukses'}` });
        // Refresh status absen setelah berhasil
        const targetId = getTargetEmployeeId(targetPegawai, config.idPegawai);
        if (targetId) fetchInfoPresensi(targetId);
      } else {
        setPresensiDetail(null);
        setOutput({ type: 'error', text: `❌ GAGAL PRESENSI\n${data.message || 'Error'}` });
      }
    } catch (err: any) {
      setPresensiDetail(null);
      setOutput({ type: 'error', text: `❌ Network Error: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  if (!pegawai) {
    return null; // App.tsx auto-redirect ke tabBeranda
  }

  // Apakah user boleh mencari & memilih pegawai lain?
  // Admin selalu bisa. User hanya bisa jika allowSearchPegawai diaktifkan admin.

  return (
    <>
      <div className="w-full mx-auto bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700/60 relative z-20">
      
      <div className="flex items-center gap-3 mb-6 relative z-10">
        <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400">
          <Calendar className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">Presensi</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">Unggah atau ambil foto untuk presensi</p>
        </div>
      </div>

      {/* Pegawai Search Section - hanya tampil jika canSearchPegawai */}
      {canSearchPegawai ? (
      <div className="bg-slate-50 dark:bg-slate-900/40 p-5 rounded-2xl border border-slate-100 dark:border-slate-700/60 mb-4 space-y-4 relative z-40">
        <div className="relative" ref={dropdownRef}>
          <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
            <User className="w-4 h-4 text-blue-500" /> Cari & Pilih Pegawai (Opsional)
          </label>
          <div className="relative">
            <input
              type="text"
              value={searchPegawai}
              onChange={(e) => {
                setSearchPegawai(e.target.value);
                if (selectedTargetPegawai) {
                  setSelectedTargetPegawai(null);
                  setSelectedTargetLocation(null);
                }
                setShowPegawaiDropdown(true);
              }}
              onFocus={() => setShowPegawaiDropdown(true)}
              placeholder="Ketik nama atau NIP pegawai..."
              className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pl-10 pr-10 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 font-medium placeholder-slate-400 dark:placeholder-slate-500 text-slate-800 dark:text-slate-100 shadow-sm"
            />
            <div className="absolute left-3 top-3.5 text-slate-400">
              <Search className="w-4 h-4" />
            </div>
            {searchPegawai && (
              <button
                type="button"
                onClick={handleClearSelection}
                className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Autocomplete recommendations list */}
          {showPegawaiDropdown && (
            <div className="absolute left-0 right-0 mt-1.5 max-h-60 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 divide-y divide-slate-100 dark:divide-slate-700/50 custom-scrollbar">
              {loadingPegawai ? (
                <div className="p-4 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" /> Memuat database pegawai...
                </div>
              ) : pegawaiLoadError ? (
                <div className="p-4 text-center text-xs text-rose-500" role="alert">
                  <p>Database pegawai gagal dimuat.</p>
                  <button type="button" onClick={() => setPegawaiLoadAttempt(value => value + 1)} className="mt-2 inline-flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400">
                    <RefreshCw className="h-3 w-3" /> Coba lagi
                  </button>
                </div>
              ) : filteredPegawai.length === 0 ? (
                <div className="p-4 text-center text-slate-400 text-xs font-medium">
                  {searchPegawai.trim() === '' ? 'Silakan ketik nama atau NIP untuk mencari' : 'Pegawai tidak ditemukan'}
                </div>
              ) : (
                filteredPegawai.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectPegawai(p)}
                    className="w-full text-left p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors flex flex-col gap-0.5"
                  >
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{p.nama}</span>
                    <span className="text-xs font-mono text-slate-500 dark:text-slate-400 flex items-center gap-2">
                      <span>NIP: {p.nip}</span>
                      <span className="text-slate-300 dark:text-slate-700">|</span>
                      <span className="truncate">{p.nama_instansi}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Selected Pegawai Details */}
        {selectedTargetPegawai ? (
          <div className="p-4 rounded-xl border border-blue-100 dark:border-blue-900/30 bg-blue-50/40 dark:bg-blue-950/10 space-y-3 animate-fade-in">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-bold text-blue-500 dark:text-blue-400 uppercase tracking-widest">Pegawai Terpilih</span>
                <h4 className="text-sm font-bold text-slate-800 dark:text-white mt-0.5">{selectedTargetPegawai.nama}</h4>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-0.5">NIP: <span className="font-mono">{selectedTargetPegawai.nip}</span></p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{selectedTargetPegawai.unor || selectedTargetPegawai.instansi}</p>
              </div>
              <button
                type="button"
                onClick={handleClearSelection}
                className="text-xs font-bold text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 border border-red-100 dark:border-red-950/30 transition-colors"
              >
                Reset ke Default
              </button>
            </div>

            <div className="h-px bg-slate-200/60 dark:bg-slate-700/50" />

            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0">
                <MapPin className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Detail Lokasi Presensi</span>
                {selectedTargetLocation ? (
                  <div className="mt-0.5">
                    <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200">{selectedTargetLocation.nama}</h5>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{selectedTargetLocation.alamat || 'Tidak ada alamat terdaftar'}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-[10px] font-mono text-slate-500 dark:text-slate-400">
                      <span>Lat: {selectedTargetLocation.latitude}</span>
                      <span>Lng: {selectedTargetLocation.longitude}</span>
                      <span>Radius: {selectedTargetLocation.radius}m</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-rose-500 font-semibold mt-0.5">
                    ⚠️ Lokasi "{selectedTargetPegawai.nama_lokasi || 'Tidak diketahui'}" tidak ditemukan di database lokasi. Menggunakan koordinat default Anda.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/40 dark:bg-slate-900/20 text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
            Akun login: <strong className="text-slate-700 dark:text-slate-300">{pegawai?.nama}</strong>.
          </div>
        )}
      </div>
      ) : (
      /* Info akun login (tampil saat pencarian pegawai disembunyikan) */
      <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-slate-700/60 mb-4">
        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/40 dark:bg-slate-900/20 text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0"></span>
          Presensi untuk: <strong className="text-slate-700 dark:text-slate-300">{pegawai?.nama}</strong>
        </div>
      </div>
      )}

      {/* Date & Time Section - Positioned underneath Pegawai selector */}
      <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700/80 rounded-2xl p-4 sm:p-5 mb-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 relative z-30">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
            <Calendar className="w-4 h-4" />
          </div>
          <div className="flex-1 sm:flex-initial">
            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">Tanggal</div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-200">{displayTanggal}</div>
          </div>
        </div>
        <div className="w-px h-10 bg-slate-200 dark:bg-slate-700 hidden sm:block"></div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Waktu</div>
            <div className="text-sm font-semibold font-mono text-slate-900 dark:text-slate-200">{timeStr}</div>
          </div>
        </div>
      </div>

      {/* ── Info Jam Kerja & Status Absen Hari Ini ─────────────────────────── */}
      <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3 relative z-20">

        {/* ── Card Jam Kerja ─────────────────────────────────────────────── */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> Jam Kerja
            </span>
            <button
              type="button"
              onClick={() => {
                const id = getTargetEmployeeId(selectedTargetPegawai || pegawai, config.idPegawai);
                if (id) fetchInfoPresensi(id);
              }}
              className="text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 transition-colors p-1 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-800/30"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${(loadingJamKerja || loadingCekAbsen) ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {loadingJamKerja ? (
            <div className="flex items-center gap-2 text-xs text-blue-500 dark:text-blue-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Memuat...
            </div>
          ) : jamKerja ? (() => {
            // Helper: extract "HH:mm" dari datetime "2026-09-21 07:00:00" atau "07:00"
            const toJam = (dt: any): string => {
              if (!dt) return '-';
              const s = String(dt);
              // Format datetime: "2026-09-21 07:00:00" — ambil jam setelah spasi/T
              const dtMatch = s.match(/\d{4}-\d{2}-\d{2}[T ](\d{2}:\d{2})/);
              if (dtMatch) return dtMatch[1];
              // Format time only: "07:00"
              const tMatch = s.match(/^(\d{2}:\d{2})/);
              return tMatch ? tMatch[1] : s;
            };
            const jamMasukBuka  = toJam(jamKerja.jam_mulai_scan_masuk);
            const jamMasukTutup = toJam(jamKerja.jam_akhir_scan_masuk);
            const jamPulangBuka = toJam(jamKerja.jam_mulai_scan_pulang);
            const jamPulangTutup= toJam(jamKerja.jam_akhir_scan_pulang);
            const jadwalMasuk   = toJam(jamKerja.jadwal_masuk);
            const jadwalPulang  = toJam(jamKerja.jadwal_pulang);
            const jamKerjaStr   = jamKerja.jam_kerja || null; // "07:30-15:45"

            return (
              <div className="space-y-2.5">
                {/* Jam kerja ringkas jika ada */}
                {jamKerjaStr && (
                  <div className="text-xs font-bold text-blue-700 dark:text-blue-300 bg-blue-100/60 dark:bg-blue-800/30 rounded-lg px-2.5 py-1 inline-block">
                    {jamKerjaStr}
                  </div>
                )}

                {/* Window scan masuk */}
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Range Presensi Masuk</div>
                    {jadwalMasuk !== '-' && (
                      <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                        Tepat waktu ≤ <span className="font-mono">{jadwalMasuk}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-slate-700 dark:text-slate-200">
                    <span className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-md">{jamMasukBuka}</span>
                    <span className="text-slate-400">–</span>
                    <span className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-md">{jamMasukTutup}</span>
                  </div>
                  <p className="text-[9px] text-slate-400 mt-1">
                    {jamMasukBuka}–{jamMasukTutup} = bisa absen · Setelah {jadwalMasuk !== '-' ? jadwalMasuk : 'jadwal'} = terlambat
                  </p>
                </div>

                {/* Window scan pulang */}
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Range Presensi Pulang</div>
                    {jadwalPulang !== '-' && (
                      <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                        Normal ≥ <span className="font-mono">{jadwalPulang}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-slate-700 dark:text-slate-200">
                    <span className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-md">{jamPulangBuka}</span>
                    <span className="text-slate-400">–</span>
                    <span className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-md">{jamPulangTutup}</span>
                  </div>
                  <p className="text-[9px] text-slate-400 mt-1">
                    Sebelum {jadwalPulang !== '-' ? jadwalPulang : 'jadwal'} = mendahului · {jadwalPulang !== '-' ? jadwalPulang : 'jadwal'}–{jamPulangTutup} = normal
                  </p>
                </div>

                {jamKerja.nama_lokasi && (
                  <div className="flex items-center gap-1 text-[10px] text-blue-500 dark:text-blue-400 font-medium">
                    <MapPin className="w-3 h-3" /> {jamKerja.nama_lokasi}
                  </div>
                )}
              </div>
            );
          })() : (
            <p className="text-xs text-slate-400 dark:text-slate-500 italic">Data jam kerja tidak tersedia</p>
          )}

        </div>

        {/* ── Card Status Absen Hari Ini ─────────────────────────────────── */}
        <div className={`border rounded-2xl p-4 ${
          cekAbsen?.absen_masuk && cekAbsen?.absen_pulang
            ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800/40'
            : cekAbsen?.absen_masuk
            ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800/40'
            : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/50'
        }`}>
          <div className="flex items-center gap-1.5 mb-3">
            <Info className={`w-3.5 h-3.5 ${
              cekAbsen?.absen_masuk && cekAbsen?.absen_pulang ? 'text-emerald-600 dark:text-emerald-400'
              : cekAbsen?.absen_masuk ? 'text-amber-600 dark:text-amber-400'
              : 'text-slate-400'
            }`} />
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Status Hari Ini</span>
          </div>

          {loadingCekAbsen ? (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Memuat...
            </div>
          ) : cekAbsen ? (
            <div className="space-y-2">
              {/* Badge ringkas */}
              <div className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full ${
                cekAbsen.absen_masuk && cekAbsen.absen_pulang
                  ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                  : cekAbsen.absen_masuk
                  ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  cekAbsen.absen_masuk && cekAbsen.absen_pulang ? 'bg-emerald-500'
                  : cekAbsen.absen_masuk ? 'bg-amber-500'
                  : 'bg-slate-400'
                }`} />
                {cekAbsen.absen_masuk && cekAbsen.absen_pulang
                  ? 'Sudah Masuk & Pulang'
                  : cekAbsen.absen_masuk
                  ? 'Sudah Masuk, Belum Pulang'
                  : 'Belum Presensi'}
              </div>

              {/* Baris masuk */}
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full inline-block ${cekAbsen.absen_masuk ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                  Masuk
                </span>
                <span className={`font-bold font-mono ${cekAbsen.absen_masuk ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}>
                  {cekAbsen.absen_masuk ? (cekAbsen.jam_masuk ? `✓ ${cekAbsen.jam_masuk}` : '✓ Sudah') : '— Belum'}
                </span>
              </div>

              {/* Baris pulang */}
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full inline-block ${cekAbsen.absen_pulang ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                  Pulang
                </span>
                <span className={`font-bold font-mono ${cekAbsen.absen_pulang ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}>
                  {cekAbsen.absen_pulang ? (cekAbsen.jam_pulang ? `✓ ${cekAbsen.jam_pulang}` : '✓ Sudah') : '— Belum'}
                </span>
              </div>

              {/* Info ijin cuti / tidak ada roster — hanya tampil jika belum ada presensi apapun */}
              {cekAbsen.ijin_cuti === true && (
                <div className="text-[10px] text-blue-600 dark:text-blue-400 font-medium pt-1 border-t border-slate-200/50 dark:border-slate-600/30">
                  📋 Hari ini: Izin / Cuti
                </div>
              )}
              {cekAbsen.ada_roster === false && !cekAbsen.absen_masuk && !cekAbsen.absen_pulang && (
                <div className="text-[10px] text-amber-600 dark:text-amber-400 font-medium pt-1 border-t border-slate-200/50 dark:border-slate-600/30">
                  ⚠ Tidak ada jadwal hari ini
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-400 dark:text-slate-500 italic">Data status absen tidak tersedia</p>
          )}

        </div>
      </div>

      <div className="space-y-6 relative z-10">
        <div>
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Foto Presensi</label>
          
          <div 
            className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-8 sm:p-12 text-center bg-slate-50 dark:bg-slate-900/30 hover:border-blue-400 dark:hover:border-blue-500/50 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-all cursor-pointer group"
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            <div className="mb-6 flex flex-col items-center justify-center gap-3">
              <div className="w-16 h-16 rounded-full bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 flex items-center justify-center text-slate-400 group-hover:text-blue-500 group-hover:scale-110 transition-all">
                <UploadCloud className="w-8 h-8" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">Tarik & lepas foto di sini</p>
              </div>
            </div>
            <div className="flex justify-center gap-3 flex-wrap">
              <button type="button" onClick={startCamera} className="bg-white dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-slate-700 dark:text-slate-200 hover:text-emerald-600 dark:hover:text-emerald-400 border border-slate-200 dark:border-slate-700 hover:border-emerald-200 dark:hover:border-emerald-800 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm transition-all flex items-center gap-2 active:scale-95">
                <CameraIcon className="w-4 h-4" /> Buka Kamera
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()} className="bg-white dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 border border-slate-200 dark:border-slate-700 hover:border-blue-200 dark:hover:border-blue-800 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm transition-all flex items-center gap-2 active:scale-95">
                <ImageIcon className="w-4 h-4" /> Pilih File
              </button>
            </div>
          </div>
        </div>
        
        <input type="file" ref={fileInputRef} accept="image/*,.heic,.heif,.tif,.tiff,.bmp,.ico,.avif,.jxl" className="hidden" onChange={handleFileChange} />
        <input type="file" ref={cameraInputRef} accept="image/*,.heic,.heif,.tif,.tiff,.bmp,.ico,.avif,.jxl" capture="user" className="hidden" onChange={handleFileChange} />
        
        {/* Live Camera View */}
        {isCameraActive && (
          <div className="modal-layer fixed inset-0 z-50 bg-black flex flex-col">
            <div className="flex justify-between items-center p-4 bg-black text-white">
              <span className="font-medium">Ambil Foto Presensi</span>
              <button onClick={stopCamera} className="p-2 bg-white/20 hover:bg-white/30 rounded-full transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-black">
              <video 
                ref={videoRef} 
                playsInline 
                autoPlay 
                muted
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <div className="p-8 bg-black flex justify-center items-center pb-12">
              <button 
                onClick={capturePhoto} 
                className="w-20 h-20 bg-white rounded-full border-4 border-slate-300 shadow-lg active:scale-95 transition-transform flex items-center justify-center"
              >
                <div className="w-16 h-16 bg-white border-2 border-slate-200 rounded-full"></div>
              </button>
            </div>
          </div>
        )}

        {base64Image && !isCameraActive && (
          <div className="mt-8 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/70 bg-slate-50 dark:bg-slate-900/30 flex flex-col items-center justify-center animate-fade-in-up">
            <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3">Pratinjau Foto Presensi</h4>
            
            <div className="relative rounded-2xl overflow-hidden shadow-md border border-slate-200 dark:border-slate-700 max-w-full max-h-[300px] flex justify-center bg-slate-100 dark:bg-slate-950">
              <img 
                src={base64Image} 
                alt="Pratinjau Foto" 
                className="max-w-full max-h-[300px] object-contain cursor-pointer transition-transform duration-300 hover:scale-[1.01]" 
                onClick={() => setModalImg({ src: base64Image, title: 'Pratinjau Foto Presensi' })}
              />
            </div>

            {/* Controls directly under photo */}
            <div className="flex justify-center gap-3 mt-4 w-full max-w-xs">
              <button 
                type="button" 
                onClick={() => setModalImg({ src: base64Image, title: 'Pratinjau Foto Presensi' })}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-850 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors border border-slate-200/40 dark:border-slate-700/40 cursor-pointer"
              >
                <Search className="w-4 h-4" /> Lihat Detail
              </button>
              <button 
                type="button" 
                onClick={() => {
                  setBase64Image('');
                  setFileInfo('');
                  setOutput(null);
                }}
                className="flex-1 py-2.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/20 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors border border-rose-100 dark:border-rose-950/30 cursor-pointer"
              >
                <X className="w-4 h-4" /> Hapus Foto
              </button>
            </div>

            {/* Tampilkan hanya rasio/dimensi dan ukuran file di bawah foto. */}
            <div className="mt-4 flex flex-col items-center text-center gap-1.5">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                {fileInfo}
              </span>
            </div>
          </div>
        )}
        
        {/* Card Section for Kirim Presensi */}
        <div className="mt-8 p-6 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 shadow-md flex flex-col gap-4">
          <button 
            onClick={() => setIsConfirmOpen(true)}
            disabled={!base64Image || loading} 
            className="w-full bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 dark:disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold py-4 px-4 rounded-xl transition-all text-base flex items-center justify-center gap-2 active:scale-[0.98] shadow-md cursor-pointer border border-blue-700 dark:border-blue-400"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            ) : (
              <Send className="w-5 h-5" />
            )}
            {loading ? 'Mengirim Data Presensi...' : 'Kirim Presensi'}
          </button>
        </div>
        
        {output && (
          <div className={`mt-6 p-4 rounded-xl text-sm font-semibold shadow-sm ${output.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20' : 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20'}`}>
            <div className="flex items-center gap-3">
              {output.type === 'success' ? <CheckCircle className="w-6 h-6 text-emerald-600 dark:text-emerald-400 shrink-0" /> : <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400 shrink-0" />}
              <span className="font-sans whitespace-pre-wrap leading-relaxed">{output.text}</span>
            </div>
          </div>
        )}

        {/* ── Detail Response Presensi ───────────────────────────────────── */}
        {presensiDetail && output?.type === 'success' && (
          <div className="mt-3 p-4 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700/60 rounded-xl space-y-2 animate-fade-in">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" /> Detail Presensi
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              {presensiDetail.status_absen && (
                <div>
                  <span className="text-slate-400 dark:text-slate-500 block text-[10px] font-bold uppercase tracking-wide">Jenis Scan</span>
                  <span className="font-bold text-blue-600 dark:text-blue-400">{presensiDetail.status_absen}</span>
                </div>
              )}
              {presensiDetail.jam_masuk && (
                <div>
                  <span className="text-slate-400 dark:text-slate-500 block text-[10px] font-bold uppercase tracking-wide">Jam Masuk</span>
                  <span className="font-bold font-mono text-emerald-600 dark:text-emerald-400">{presensiDetail.jam_masuk}</span>
                </div>
              )}
              {presensiDetail.jam_pulang && (
                <div>
                  <span className="text-slate-400 dark:text-slate-500 block text-[10px] font-bold uppercase tracking-wide">Jam Pulang</span>
                  <span className="font-bold font-mono text-emerald-600 dark:text-emerald-400">{presensiDetail.jam_pulang}</span>
                </div>
              )}
              {presensiDetail.ada_shift !== null && presensiDetail.ada_shift !== undefined && (
                <div>
                  <span className="text-slate-400 dark:text-slate-500 block text-[10px] font-bold uppercase tracking-wide">Shift</span>
                  <span className={`font-bold ${presensiDetail.ada_shift ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'}`}>
                    {presensiDetail.ada_shift ? 'Ada Shift' : 'Tidak Ada Shift'}
                  </span>
                </div>
              )}
              {presensiDetail.belum_verifikasi !== null && presensiDetail.belum_verifikasi !== undefined && (
                <div>
                  <span className="text-slate-400 dark:text-slate-500 block text-[10px] font-bold uppercase tracking-wide">Verifikasi</span>
                  <span className={`font-bold ${presensiDetail.belum_verifikasi ? 'text-amber-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {presensiDetail.belum_verifikasi ? 'Belum Terverifikasi' : 'Terverifikasi'}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
      
    {modalImg && (
      <ImageLightbox src={modalImg.src} title={modalImg.title} onClose={() => setModalImg(null)} />
    )}

    {/* Confirmation Modal */}
    <AnimatePresence>
      {isConfirmOpen && (
        <div className="modal-layer fixed inset-0 z-[150] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsConfirmOpen(false)}
            className="absolute inset-0 bg-slate-950/80"
          />
          
          {/* Modal Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: "spring", duration: 0.3 }}
            className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-800/80 overflow-hidden flex flex-col z-10 animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="w-full flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-5">
              <span className="font-bold text-slate-800 dark:text-white text-sm">Konfirmasi Kirim Presensi</span>
              <button 
                onClick={() => setIsConfirmOpen(false)} 
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            <div className="flex items-center gap-3 bg-blue-50 dark:bg-blue-950/20 text-blue-800 dark:text-blue-400 p-4 rounded-2xl mb-5 border border-blue-100 dark:border-blue-900/30">
              <AlertTriangle className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
              <p className="text-xs font-semibold leading-relaxed">
                Mohon periksa kembali detail presensi Anda di bawah ini sebelum mengirim data.
              </p>
            </div>

            {/* Info Table / Details */}
            <div className="space-y-3.5 bg-slate-50 dark:bg-slate-950/40 p-4 rounded-2xl border border-slate-100 dark:border-slate-800/80 mb-6">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nama Pegawai</span>
                <span className="text-sm font-bold text-slate-800 dark:text-white">{(selectedTargetPegawai || pegawai)?.nama || 'Tidak Tersedia'}</span>
              </div>
              <div className="h-px bg-slate-200/50 dark:bg-slate-800/60" />
              
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">NIP</span>
                <span className="text-sm font-semibold font-mono text-slate-700 dark:text-slate-300">{(selectedTargetPegawai || pegawai)?.nip || '-'}</span>
              </div>
              <div className="h-px bg-slate-200/50 dark:bg-slate-800/60" />

              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tanggal</span>
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{displayTanggal}</span>
              </div>
              <div className="h-px bg-slate-200/50 dark:bg-slate-800/60" />

              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Waktu</span>
                <span className="text-sm font-semibold font-mono text-slate-700 dark:text-slate-300">{timeStr}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setIsConfirmOpen(false)}
                className="w-full py-3 px-4 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-sm transition-colors cursor-pointer text-center"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsConfirmOpen(false);
                  submitAbsen();
                }}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                Ya, Kirim
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified page: dispatch by profile mode
// ─────────────────────────────────────────────────────────────────────────────

export default function Presensi() {
  const { serverProfile } = useAppContext();
  if (serverProfile?.mode === 'ponorogo-absensi') {
    return <PonorogoPresensiPage />;
  }
  return <BkdPresensi />;
}
