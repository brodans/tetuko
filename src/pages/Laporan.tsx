import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarRange,
  Coins,
  Download,
  FileCheck,
  FileDown,
  FileSpreadsheet,
  FileText,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  Users,
  X,
} from 'lucide-react';
import { useAppContext, usePonorogoAppContext } from '../context/AppContext';
import { useServerContext } from '../hooks/useServerContext';
import { selCsv, unduhExcel } from '../lib/excelXml';
import type { SelExcel } from '../lib/excelXml';
import { unduhTeks } from '../lib/unduh';
import { unduhPdf } from '../lib/pdfTabel';
import { useToast } from '../components/ui/Toast';
import { saveBlobSmart } from '../lib/nativeSave';
import {
  ActionButton,
  Alert,
  Badge,
  Card,
  CardTitle,
  DataTable,
  EmptyState,
  Field,
  SkeletonTable,
  StatTile,
  type Column,
} from '../components/ui/Surface';
import DatePicker from '../components/ui/DatePicker';
import { TombolMenu } from '../components/ui/TombolMenu';
import { rpcGetWorkCode, rpcHistoryAbsen, type HistoryAbsenModel, type WorkCodeView } from '../lib/apiCalls';
import { getTodayWIB, getTodayWIBWithDaysOffset, getTodayWIBWithOffset, timeToMinutes } from '../lib/dateFormatter';
import { ABSEN_CHECK_TYPE } from '../lib/presensiContract';
import Dropdown from '../components/ui/Dropdown';
import {
  jamTampil,
  labelCheckType,
  pilihWorkCodeUntukHari,
  tanggalKeIso,
  terlambatCompared,
  type AbsensiHarianView,
} from '../lib/viewModels';
import { OPD_LIST, loadOpdList } from '../data/opd';
import { usePegawaiSearch } from '../hooks/usePegawaiSearch';
import { loadPegawaiSearchList } from '../lib/pegawaiData';
import { fetchReport, isTauri } from '../api';
import ReportDocumentPreview from '../components/ui/ReportDocumentPreview';


type ReportType = 'riwayat' | 'rekap';

/**
 * Server pusat hanya punya satu endpoint laporan: `history_absen`.
 * Object `laporan` dan `presensi` sama-sama dibalas `-32601 Object not
 * found`, jadi "Rekap" di sini adalah agregasi lokal dari `history_absen`.
 *
 * `history_absen` mengembalikan SATU BARIS PER PUKUL (satu baris "Datang",
 * satu baris "Pulang"), bukan satu baris per hari. Karena itu laporan
 * punya dua tampilan: "Riwayat" menampilkan baris mentah apa adanya
 * seperti aplikasi asli, "Rekap" memivotnya menjadi satu baris per
 * pegawai per tanggal.
 */
const REPORT_TYPES: { value: ReportType; label: string; rpc: string; hint: string }[] = [
  {
    value: 'riwayat',
    label: 'Riwayat Absen',
    rpc: 'history_absen',
    hint: 'Baris mentah dari server pusat: satu baris per rekaman absensi.',
  },
  {
    value: 'rekap',
    label: 'Rekap Harian',
    rpc: 'history_absen',
    hint: 'Rekap absensi per pegawai per tanggal.',
  },
];

/** Berapa baris yang ditarik per halaman `history_absen`. */
const HISTORY_PAGE_LIMIT = 200;
/** Batas hari yang dijahit per muatan — `history_absen` satu tanggal per panggilan. */
const MAX_REPORT_DAYS = 62;

function BkdLaporan() {
  const { pegawai, loginForm, laporanLogState, setLaporanLogState, serverProfile } = useAppContext();
  const { context, ready } = useServerContext();
  const toast = useToast();

  const { dateStart, dateEnd, reportType, hasLoadedOnce } = laporanLogState;

  const [rows, setRows] = useState<HistoryAbsenModel[]>([]);
  const [workCodes, setWorkCodes] = useState<WorkCodeView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Nomor urut muatan yang sedang berjalan.
   *
   * ⚠️ Tanpa ini, dua muatan yang tumpang tindih bisa saling menimpa.
   * `dateStart`/`dateEnd` bisa diganti beberapa kali dengan cepat, dan
   * `loadData` menembakkan satu request **per hari** (sampai 62). Rentang
   * yang lebih baru belum tentu selesai lebih dulu — jaringan tidak menjamin
   * urutan — jadi muatan lama yang telat selesai akan menimpa hasilnya dan
   * tabel menampilkan data untuk rentang yang sudah tidak dipilih.
   *
   * Pola yang dipakai: setiap muatan mengambil nomor, dan hanya muatan dengan
   * nomor terbesar yang boleh menulis state. `ref` dipakai karena nomor harus
   * terbaca di dalam continuation async, bukan di deps effect.
   */
  const muatanSeq = useRef(0);

  const activeReport = useMemo(
    () => REPORT_TYPES.find(item => item.value === reportType) ?? REPORT_TYPES[0],
    [reportType]
  );

  // ── Muat data ────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!ready) return;
    const seq = ++muatanSeq.current;
    const usang = () => seq !== muatanSeq.current;
    setLoading(true);
    setError(null);
    try {
      // Satu-satunya sumber data: `history_absen` per tanggal, dijahit
      // harian karena server hanya menerima satu `tgl` per panggilan.
      // Work code diambil bersamaan untuk mengetahui batas jam masuk saat rekap.
      const [codes, ...pages] = await Promise.all([
        rpcGetWorkCode(context),
        ...eachDate(dateStart, dateEnd).map(tgl =>
          rpcHistoryAbsen(context, { tgl, page: 1, limit: HISTORY_PAGE_LIMIT })
        ),
      ]);
      if (usang()) return;
      setWorkCodes(codes);
      setRows(pages.flat());
      setLaporanLogState(prev => ({ ...prev, hasLoadedOnce: true }));
    } catch (err: any) {
      if (usang()) return;
      setError(err?.message ?? 'Gagal memuat laporan.');
      setRows([]);
    } finally {
      if (!usang()) setLoading(false);
    }
  }, [context, ready, dateStart, dateEnd, setLaporanLogState]);

  /*
   * Muat saat rentang tanggal berubah, atau saat pertama kali halaman dibuka.
   *
   * ⚠️ `reportType` **tidak** ada di dependensi, dan itu disengaja. Kedua
   * jenis laporan — "Riwayat Absen" dan "Rekap Harian" — memakai RPC yang
   * sama persis (`history_absen`); rekap hanya pivot lokal dari baris yang
   * sudah ada. Memuat ulang saat jenis diganti berarti menembakkan ulang
   * seluruh 1 + jumlah hari request hanya untuk menggambar ulang tabel yang
   * datanya identik — dan karena `patch()` menyalakan `hasLoadedOnce` lagi,
   * tabel ikut berkedip kosong di tengahnya.
   */
  useEffect(() => {
    if (hasLoadedOnce) return;
    void loadData();
  }, [hasLoadedOnce, ready, dateStart, dateEnd, loadData]);

  // Semua baris dari rentang tanggal ditampilkan apa adanya. Penyaring
  // tanggal sudah berasal dari rentang yang dipilih, dan penyaring tambahan
  // tidak dimungkinkan karena `history_absen` tidak punya kolom NIP.
  const filtered = rows;

  // ── Rekap harian (pivot per pegawai per tanggal) ────────────────
  const rekap = useMemo(() => buildRekap(filtered, workCodes), [filtered, workCodes]);

  // ── Statistik ────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const days = new Set<string>();
    for (const row of filtered) {
      const iso = tanggalKeIso(row.waktu);
      if (iso) days.add(iso);
    }
    const terlambat = rekap.filter(item => item.status === 'terlambat').length;
    return {
      total: filtered.length,
      hari: days.size,
      hadir: rekap.length - terlambat,
      terlambat,
      tanpaPulang: rekap.filter(item => item.jamPulang === null).length,
      rataMasuk: averageMinutes(rekap.map(item => item.jamMasuk)),
      rataKeluar: averageMinutes(rekap.map(item => item.jamPulang)),
    };
  }, [filtered, rekap]);

  const patch = (next: Partial<typeof laporanLogState>) =>
    setLaporanLogState(prev => ({ ...prev, ...next, hasLoadedOnce: false }));

  // ── Ekspor ────────────────────────────────────────────────────────
  /*
   * Satu tombol, tiga format — dan tiap format memang beda kegunaan nyata.
   *
   * Semula ada dropdown "Format Unduhan" yang menjanjikan "Excel / CSV",
   * padahal nilainya tidak pernah dibaca: tombol Ekspor selalu menghasilkan
   * CSV. Dropdown itu dihapus, dan spreadsheet sungguhan ditulis sendiri
   * (`lib/excelXml.ts`) supaya pilihan "Excel" bukan janji kosong.
   *
   * Namun ketiga format langsung jadi tiga tombol di kepala halaman, dan baris
   * aksinya jadi ±354 px — di layar 360 px yang tersedia hanya 328 px, sehingga
   * tombol terakhir keluar viewport tanpa ada yang memberi tahu.
   *
   * Sekarang format berhenti jadi tombol dan **pilihannya** yang jadi menu.
   * Format dipakai rutin, jadi namanya harus terlihat tanpa klik; yang layak
   * disembunyikan hanya daftar pilihannya.
   */
  const tanpaData = useCallback(() => {
    toast.info('Tidak ada data untuk diekspor.');
    return true;
  }, [toast]);

  /** `laporan-riwayat-2026-09-01_2026-09-30` — sama untuk tiga format. */
  const namaBerkas = `laporan-${reportType}-${dateStart}_${dateEnd}`;

  const exportExcel = () => {
    if (filtered.length === 0) return void tanpaData();
    unduhExcel(namaBerkas, [lembarRiwayat(filtered), lembarRekap(rekap)]);
    toast.success(`${filtered.length} baris diekspor ke Excel, lengkap dengan rekap harian.`);
  };

  const exportCsv = () => {
    if (filtered.length === 0) return void tanpaData();
    unduhTeks(
      `${namaBerkas}.csv`,
      '\ufeff' + (reportType === 'rekap' ? rekapCsv(rekap) : riwayatCsv(filtered)),
      'text/csv'
    );
    toast.success(`${filtered.length} baris diekspor ke CSV.`);
  };

  const [sibukPdf, setSibukPdf] = useState(false);

  const exportPdf = async () => {
    if (filtered.length === 0) return void tanpaData();
    setSibukPdf(true);
    try {
      await unduhPdf({
        nama: namaBerkas,
        judul: activeReport.label,
        subjudul: `Periode ${dateStart} sampai ${dateEnd}`,
        meta: [
          `Sumber data: ${serverProfile?.gatewayUrl || 'server presensi aktif'}`,
          `Akun: ${(pegawai?.nip || loginForm.username || "-") ?? '-'} · ${filtered.length} baris`,
        ],
        catatan:
          reportType === 'rekap'
            ? 'Rekap harian dihitung lokal dari riwayat absensi.'
            : 'Baris ditampilkan apa adanya seperti pada aplikasi asli.',
        tabel:
          reportType === 'rekap'
            ? {
                header: [...HEADER_REKAP],
                baris: isiRekap(rekap),
                // Bobot, bukan milimeter: kolom Pegawai memang butuh ruang
                // dua kali kolom Jam Masuk, dan angka ini ikut menentukan
                // berapa karakter yang muat sebelum dipotong.
                lebar: [34, 22, 13, 11, 12, 11, 11],
                rata: ['kiri', 'kiri', 'kiri', 'tengah', 'tengah', 'kanan', 'tengah'],
              }
            : {
                header: [...HEADER_RIWAYAT],
                baris: isiRiwayat(filtered),
                lebar: [32, 22, 12, 10, 12, 13, 10],
                rata: ['kiri', 'kiri', 'kiri', 'tengah', 'tengah', 'tengah', 'kanan'],
              },
      });
      toast.success('Laporan PDF berhasil dibuat.');
    } catch (galat) {
      console.error('[laporan] gagal membuat PDF', galat);
      toast.error('PDF gagal dibuat. Coba lagi, atau pakai Excel kalau browsernya tidak mendukung.');
    } finally {
      setSibukPdf(false);
    }
  };

  const visible = reportType === 'rekap' ? rekap : filtered;

  return (
    <div className="space-y-6">
      {error && <Alert tone="rose">{error}</Alert>}

      {/* Jenis laporan dan rentang tanggal berbagi lebar yang seimbang. */}
      <Card className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Jenis Laporan">
            <Dropdown
              value={reportType}
              onChange={value => patch({ reportType: value })}
              opsi={REPORT_TYPES.map(item => ({
                value: item.value,
                label: item.label,
                hint: item.hint,
              }))}
              aria-label="Jenis laporan"
            />
          </Field>

          <DatePicker
            className="w-full"
            label="Dari Tanggal"
            value={dateStart}
            onChange={value => patch({ dateStart: value })}
            max={dateEnd}
          />
          <DatePicker
            className="w-full"
            label="Sampai Tanggal"
            value={dateEnd}
            onChange={value => patch({ dateEnd: value })}
            min={dateStart}
            max={getTodayWIBWithDaysOffset(365)}
          />
        </div>

          <div className="flex flex-col gap-3 border-t border-slate-100 dark:border-slate-700/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Rentang
            </span>
            <ActionButton
              variant="ghost"
              size="sm"
              onClick={() => patch({ dateStart: getTodayWIBWithDaysOffset(-7), dateEnd: getTodayWIB() })}
            >
              7 Hari
            </ActionButton>
            <ActionButton
              variant="ghost"
              size="sm"
              onClick={() => patch({ dateStart: getTodayWIBWithDaysOffset(-30), dateEnd: getTodayWIB() })}
            >
              30 Hari
            </ActionButton>
          </div>

            <ActionButton block className="sm:w-auto" onClick={() => void loadData()} loading={loading} icon={<BarChart3 className="w-4 h-4" />}>
            Tampilkan Laporan
          </ActionButton>
        </div>
      </Card>

      {/* ── Statistik ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile
          label="Total Baris"
          value={stats.total}
          tone="blue"
          icon={<CalendarRange className="w-4 h-4" />}
          hint={`${stats.hari} hari terliput`}
        />
        <StatTile label="Hadir" value={stats.hadir} tone="emerald" hint={formatMinutes(stats.rataMasuk)} />
        <StatTile label="Terlambat" value={stats.terlambat} tone="amber" hint={formatMinutes(stats.rataKeluar)} />
        <StatTile label="Belum Absen Pulang" value={stats.tanpaPulang} tone="rose" hint="Absen pulang belum tercatat" />
      </div>

      {/* ── Tabel laporan ────────────────────────────────────────── */}
      <Card padded={false} className="p-5 sm:p-6 print:shadow-none print:border-0">
        <CardTitle
          action={
            <div className="flex items-center justify-end gap-2 sm:flex-wrap">
              <ActionButton
                variant="ghost"
                size="sm"
                onClick={() => void loadData()}
                loading={loading}
                icon={<RefreshCw className="w-4 h-4" />}
                aria-label="Muat ulang laporan"
                title="Muat ulang"
                className="!p-2 sm:!px-3 sm:!py-1.5"
              >
                <span className="hidden sm:inline">Muat Ulang</span>
              </ActionButton>
              <TombolMenu
                label="Ekspor"
                icon={<Download className="w-4 h-4" />}
                variant="primary"
                disabled={visible.length === 0}
                loading={sibukPdf}
                ariaLabel="Ekspor laporan"
                labelClassName="hidden sm:inline"
                className="!p-2 sm:!px-3 sm:!py-1.5"
                items={[
                  {
                    id: 'excel',
                    label: 'Excel',
                    hint: '.xls · dua lembar (riwayat + rekap) · kolom Jarak bisa dijumlahkan',
                    icon: FileSpreadsheet,
                    onClick: exportExcel,
                  },
                  {
                    id: 'pdf',
                    label: 'PDF',
                    hint: '.pdf · A4 mendatar · teksnya bisa dicari, bukan gambar',
                    icon: FileDown,
                    onClick: () => void exportPdf(),
                  },
                  {
                    id: 'csv',
                    label: 'CSV',
                    hint: '.csv · untuk diimpor ke sistem lain',
                    icon: FileText,
                    onClick: exportCsv,
                  },
                ]}
              />
            </div>
          }
        >
          {activeReport.label}
        </CardTitle>
        {loading ? (
          <SkeletonTable columns={reportType === 'rekap' ? rekapColumns.length : riwayatColumns.length} rows={6} />
        ) : visible.length === 0 ? (
          <EmptyState message="Belum ada data laporan." hint="Ubah rentang tanggal atau jenis laporan, lalu muat ulang." />
        ) : reportType === 'rekap' ? (
          <DataTable
            columns={rekapColumns}
            rows={rekap}
            keyOf={(row, index) => `${row.nama}-${row.tanggal}-${index}`}
          />
        ) : (
          <DataTable
            columns={riwayatColumns}
            rows={filtered}
            keyOf={(row, index) => `${row.nama}-${row.waktu}-${index}`}
          />
        )}

        {visible.length > 0 && (
          <p className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 text-[11px] text-slate-400 dark:text-slate-500 print:hidden">
            Sumber data: <span className="font-mono">{serverProfile?.gatewayUrl || 'server presensi aktif'}</span> · akun{' '}
            {(pegawai?.nip || loginForm.username || "-") ?? '-'}
            {reportType === 'rekap' && ' · rekap dihitung lokal'}
          </p>
        )}
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Pivot baris per rekaman → satu baris per pegawai per tanggal
// ═══════════════════════════════════════════════════════════════════════

/**
 * Kelompokkan baris `history_absen` menjadi satu entri per
 * (pegawai, tanggal).
 *
 * `jam_masuk_awal` diambil dari work code yang cocok dengan tanggal
 * tersebut supaya keterlambatan bisa dihitung lokal — `history_absen`
 * tidak mengirim kolom status sama sekali.
 */
function buildRekap(rows: HistoryAbsenModel[], codes: WorkCodeView[]): AbsensiHarianView[] {
  const groups = new Map<string, HistoryAbsenModel[]>();
  for (const row of rows) {
    const iso = tanggalKeIso(row.waktu);
    if (!iso) continue;
    const key = `${row.nama ?? ''}|${iso}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const out: AbsensiHarianView[] = [];
  for (const [key, bucket] of groups) {
    const iso = key.slice(key.lastIndexOf('|') + 1);
    const schedule = pilihWorkCodeUntukHari(codes, iso);
    const punches = bucket.slice().sort((a, b) => String(a.waktu).localeCompare(String(b.waktu)));
    const masuk = punches.find(row => isDatang(row.checktype));
    const pulang = punches.find(row => isPulang(row.checktype));
    const reference = masuk ?? punches[0];
    const jamMasuk = jamTampil(masuk?.waktu ?? reference?.waktu);

    out.push({
      tanggal: iso,
      nama: String(reference?.nama ?? ''),
      departemen: String(reference?.departemen ?? ''),
      jamMasuk,
      jamPulang: jamTampil(pulang?.waktu),
      jarak: String(masuk?.jarak ?? reference?.jarak ?? ''),
      // Toleransi 15 menit tidak ditulis di sini. Angkanya hidup di satu
      // tempat (`terlambatCompared`); dua salinan berarti diam-diam bisa
      // berbeda begitu salah satu diubah.
      status: terlambatCompared(jamMasuk, schedule?.jam.jam_masuk_awal) ? 'terlambat' : 'hadir',
      punches,
    });
  }

  return out.sort((a, b) => b.tanggal.localeCompare(a.tanggal) || a.nama.localeCompare(b.nama));
}

function isDatang(checktype: unknown): boolean {
  const text = String(checktype ?? '').trim().toLowerCase();
  return text === 'datang' || text === String(ABSEN_CHECK_TYPE.DATANG);
}

function isPulang(checktype: unknown): boolean {
  const text = String(checktype ?? '').trim().toLowerCase();
  return text === 'pulang' || text === String(ABSEN_CHECK_TYPE.PULANG);
}

// ═══════════════════════════════════════════════════════════════════════
//  Kolom tabel
// ═══════════════════════════════════════════════════════════════════════

/** Baris mentah `history_absen` — ditampilkan apa adanya seperti aplikasi asli. */
const riwayatColumns: Column<HistoryAbsenModel>[] = [
  {
    key: 'nama',
    header: 'Pegawai',
    /*
     * ⚠️ `max-w-[220px]` itu **wajib**, bukan hiasan.
     *
     * `truncate` sendirian tidak membatasi apa pun: di dalam tabel
     * `table-layout: auto`, lebar min-content sebuah sel tetap sebesar
     * teks penuhnya, karena nowrap tidak pernah membungkus. Diukur di DOM,
     * nama seperti "Agus Prasetyo / UPT Informatika Dinas Komunikasi dan
     * Informatika" membuat kolom Pegawai melebar **277 px**, dan tabel
     * 686 px — sedangkan wadah di 1024 px hanya **644 px** (sidebar
     * melebar ke `w-64` tepat di titik itu, jadi wadah justru menyempit
     * dibanding 768 px). Akibatnya kolom paling kanan keluar layar persis
     * di lebar yang biasanya dianggap aman.
     *
     * Yang menurunkan min-content hanyalah `max-width` pada sel/isi —
     * `max-w-0 w-full` atau `min-w-0` saja tidak, keduanya tetap mengukur
     * teks penuh. Dengan plafon 220 px tabel jadi 629 px, di bawah kuota
     * 644 px, dan truncate akhirnya berfungsi seperti seharusnya.
     */
    className: 'max-w-[220px]',
    render: row => (
      <div className="min-w-0">
        <p className="font-semibold text-slate-700 dark:text-slate-200 truncate">
          {row.nama || '-'}
        </p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
          {row.departemen || '-'}
        </p>
      </div>
    ),
  },
  {
    key: 'tanggal',
    header: 'Tanggal',
    /*
     * Lebar eksplisit, bukan "biarkan meyakinkan diri sendiri".
     *
     * Tanpa `w-*`, `DataTable` memakai auto-layout dan kolom ini bersaing
     * dengan kolom yang isinya `truncate` — dan truncate-lah yang kalah,
     * karena ia mau menyusut. Akibatnya tanggal ikut terpotong padahal
     * formatnya `2026-03-01` yang hanya 10 karakter.
     *
     * `whitespace-nowrap` saja tidak menolong: ia mencegah pembungkusan baris,
     * bukan pemampatan kolom — dan `w-full` + `min-w-[640px]` tetap membuat
     * browser membagi ruang sesuai proporsi konten yang bisa menyusut.
     */
    className: 'w-[110px]',
    render: row => (
      <span className="font-mono text-xs whitespace-nowrap">{tanggalKeIso(row.waktu) ?? '-'}</span>
    ),
  },
  {
    key: 'waktu',
    header: 'Waktu',
    // `HH:MM` — 5 karakter, selalu muat; lebarnya dikunci supaya kolom Jam
    // Masuk/Pulang di tabel rekap tidak ikut bergeser-bergeser.
    className: 'w-[80px]',
    render: row => <span className="font-mono text-xs whitespace-nowrap">{jamTampil(row.waktu) ?? '-'}</span>,
  },
  {
    key: 'checktype',
    header: 'Jenis Absen',
    render: row => <Badge tone={isDatang(row.checktype) ? 'blue' : isPulang(row.checktype) ? 'violet' : 'slate'}>{labelCheckType(row.checktype)}</Badge>,
  },
  {
    key: 'approval',
    header: 'Persetujuan',
    render: row => (row.approval ? <Badge tone="emerald">{row.approval_text || 'Disetujui'}</Badge> : <Badge tone="amber">-</Badge>),
  },
  {
    key: 'jarak',
    header: 'Jarak',
    render: row => <span className="font-mono text-xs whitespace-nowrap">{row.jarak || '-'}</span>,
  },
];

/** Baris rekap harian hasil pivot lokal. */
const rekapColumns: Column<AbsensiHarianView>[] = [
  {
    key: 'nama',
    header: 'Pegawai',
    // Sama seperti di `riwayatColumns`: `truncate` tanpa plafon `max-width`
    // tidak membatasi apa pun, dan kolom Pegawai ikut melebar sampai
    // 277 px di kondisi terburuk. Lihat catatan panjang di sana.
    className: 'max-w-[220px]',
    render: row => (
      <div className="min-w-0">
        <p className="font-semibold text-slate-700 dark:text-slate-200 truncate">{row.nama || '-'}</p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{row.departemen || '-'}</p>
      </div>
    ),
  },
  {
    key: 'tanggal',
    header: 'Tanggal',
    // Sama seperti di `riwayatColumns`: lebar eksplisit supaya tidak bersaing
    // dengan kolom `truncate`. Lihat catatan panjang di sana.
    className: 'w-[110px]',
    render: row => <span className="font-mono text-xs whitespace-nowrap">{row.tanggal}</span>,
  },
  {
    key: 'masuk',
    header: 'Jam Masuk',
    render: row => (
      <span
        className={`font-mono text-xs whitespace-nowrap ${
          row.status === 'terlambat' ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''
        }`}
      >
        {row.jamMasuk ?? '-'}
      </span>
    ),
  },
  {
    key: 'keluar',
    header: 'Jam Pulang',
    render: row => <span className="font-mono text-xs whitespace-nowrap">{row.jamPulang ?? '-'}</span>,
  },
  {
    key: 'jarak',
    header: 'Jarak',
    render: row => <span className="font-mono text-xs whitespace-nowrap">{row.jarak || '-'}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    render: row =>
      row.status === 'terlambat' ? <Badge tone="amber">Terlambat</Badge> : <Badge tone="emerald">Hadir</Badge>,
  },
];

// ═══════════════════════════════════════════════════════════════════════
//  Ekspor
// ═══════════════════════════════════════════════════════════════════════

/*
 * Kepala tabel didefinisikan **sekali** dan dipakai berdua oleh CSV dan Excel.
 *
 * Semula tiap format punya daftar header sendiri. Dua daftar itu pernah
 * berbeda satu kolom — dan karena yang tampil di layar menjadi acuan,
 * berkas yang diunduh jadi menyesatkan. Sekarang `riwayatCsv` dan
 * `lembarRiwayat` membaca header yang sama, jadi tidak mungkin lagi menyimpang.
 */
const HEADER_RIWAYAT = [
  'Nama', 'Departemen', 'Tanggal', 'Waktu', 'Jenis Absen', 'Persetujuan', 'Jarak',
] as const;

/** Lebar kolom Excel dalam satuan karakter, mengikuti isi tiap kolom. */
const LEBAR_RIWAYAT = [200, 140, 96, 96, 110, 110, 64];
const LEBAR_REKAP = [200, 140, 96, 96, 96, 64, 110];

function isiRiwayat(rows: HistoryAbsenModel[]): SelExcel[][] {
  return rows.map(row => [
    row.nama,
    row.departemen,
    tanggalKeIso(row.waktu),
    row.waktu,
    labelCheckType(row.checktype),
    row.approval ? row.approval_text || 'Disetujui' : 'Belum disetujui',
    // Angka, bukan teks: di Excel kolom ini bisa dijumlahkan dan diurutkan.
    row.jarak,
  ]);
}

function isiRekap(rows: AbsensiHarianView[]): SelExcel[][] {
  return rows.map(row => [
    row.nama,
    row.departemen,
    row.tanggal,
    row.jamMasuk,
    row.jamPulang,
    row.jarak,
    row.status,
  ]);
}

const HEADER_REKAP = [
  'Nama', 'Departemen', 'Tanggal', 'Jam Masuk', 'Jam Pulang', 'Jarak', 'Status',
] as const;

/** Lembar Excel "Riwayat". */
function lembarRiwayat(rows: HistoryAbsenModel[]) {
  return {
    nama: 'Riwayat',
    header: [...HEADER_RIWAYAT],
    baris: isiRiwayat(rows),
    lebar: LEBAR_RIWAYAT,
  };
}

/** Lembar Excel "Rekap Harian". */
function lembarRekap(rows: AbsensiHarianView[]) {
  return {
    nama: 'Rekap Harian',
    header: [...HEADER_REKAP],
    baris: isiRekap(rows),
    lebar: LEBAR_REKAP,
  };
}

/*
 * ⚠️ `selCsv` dari `lib/excelXml`, bukan versi lokal lagi.
 *
 * Versi lokal hanya meng-escape tanda kutip, jadi sel yang diawali `=`, `+`,
 * `-`, atau `@` tetap dibaca Excel sebagai rumus. Nama pegawai yang isinya
 * `=HYPERLINK(...)` akan dieksekusi begitu CSV dibuka.
 */
function barisCsv(header: readonly string[], isi: SelExcel[][]): string {
  return [header.map(h => selCsv(h)).join(','), ...isi.map(r => r.map(selCsv).join(','))].join('\n');
}

function riwayatCsv(rows: HistoryAbsenModel[]): string {
  return barisCsv(HEADER_RIWAYAT, isiRiwayat(rows));
}

function rekapCsv(rows: AbsensiHarianView[]): string {
  return barisCsv(HEADER_REKAP, isiRekap(rows));
}

// ═══════════════════════════════════════════════════════════════════════
//  Helper
// ═══════════════════════════════════════════════════════════════════════

/**
 * Daftar tanggal `yyyy-mm-dd` dari `start` sampai `end` (inklusif).
 *
 * `history_absen` hanya menerima satu `tgl` per panggilan, jadi rentang
 * laporan dijahit dengan mengulang endpoint per hari. Dibatasi `maxDays`
 * agar rentang yang tidak masuk akal tidak menembak server.
 */
function eachDate(start: string, end: string, maxDays = MAX_REPORT_DAYS): string[] {
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return out;
  while (cursor <= last && out.length < maxDays) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** Rata-rata menit sejak tengah malam dari daftar jam "HH:MM". */
function averageMinutes(values: (string | null)[]): number | null {
  let total = 0;
  let count = 0;
  for (const value of values) {
    const minutes = timeToMinutes(value ?? '');
    if (minutes === null) continue;
    total += minutes;
    count += 1;
  }
  return count === 0 ? null : Math.round(total / count);
}

function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '-';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `rata-rata ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

interface PegawaiSelection {
  id: string;
  nip: string;
  nama: string;
  nama_instansi?: string;
  nama_unit_kerja?: string;
  kode_unor?: string;
}

interface InstansiSelection {
  kode: string;
  nama: string;
}

function PonorogoLaporanPage() {
  const { pegawai, config, tabPermissions, userRole } = usePonorogoAppContext();
  const toast = useToast();

  // Tentukan jenis laporan yang boleh diakses
  const canReport = {
    perPegawai:            userRole === 'admin' || tabPermissions.reportPerPegawai,
    perPegawaiAktivitas:   userRole === 'admin' || tabPermissions.reportPerPegawaiAktivitas,
    skorPerInstansi:       userRole === 'admin' || tabPermissions.reportSkorPerInstansi,
    aktivitasPerInstansi:  userRole === 'admin' || tabPermissions.reportAktivitasPerInstansi,
    rekapTppAktivitas:     userRole === 'admin' || tabPermissions.reportRekapTppAktivitas,
  };
  // Boleh cari pegawai/instansi lain jika admin atau permission allowSearchLaporan aktif
  const canSearchLaporan = userRole === 'admin' || tabPermissions.allowSearchLaporan;

  const instansiDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (instansiDropdownRef.current && !instansiDropdownRef.current.contains(event.target as Node)) {
        setShowInstansiDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // General state
  const [reportType, setReportType] = useState<'per-pegawai' | 'per-pegawai-aktivitas' | 'skor-per-instansi' | 'aktivitas-per-instansi' | 'rekap-tpp-aktivitas'>(() => {
    // Default ke tipe pertama yang diizinkan
    if (canReport.perPegawai) return 'per-pegawai';
    if (canReport.perPegawaiAktivitas) return 'per-pegawai-aktivitas';
    if (canReport.skorPerInstansi) return 'skor-per-instansi';
    if (canReport.aktivitasPerInstansi) return 'aktivitas-per-instansi';
    return 'rekap-tpp-aktivitas';
  });
  const [reportFormat, setReportFormat] = useState<'pdf' | 'xls'>('pdf');
  const [dateStart, setDateStart] = useState(() => getTodayWIBWithOffset(-1));
  const [dateEnd, setDateEnd] = useState(() => getTodayWIB());
  
  // Pegawai Selection state
  const [pegawaiList, setPegawaiList] = useState<PegawaiSelection[]>([]);
  const [loadingPegawai, setLoadingPegawai] = useState(false);
  const {
    selectedPegawai,
    setSelectedPegawai,
    searchPegawai,
    setSearchPegawai,
    showPegawaiDropdown,
    setShowPegawaiDropdown,
    pegawaiDropdownRef,
    filteredPegawai,
  } = usePegawaiSearch(pegawaiList);

  // Instansi Selection state
  const [instansiList, setInstansiList] = useState<InstansiSelection[]>([]);
  const [selectedInstansi, setSelectedInstansi] = useState<InstansiSelection | null>(null);
  const [searchInstansi, setSearchInstansi] = useState('');
  const [showInstansiDropdown, setShowInstansiDropdown] = useState(false);
  const [manualInstansiId, setManualInstansiId] = useState('');
  
  // Status filter for OPD reports
  const [statusFilter, setStatusFilter] = useState('all');

  // Preview & Generation state
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [reportBlob, setReportBlob] = useState<Blob | null>(null);
  const [reportFileName, setReportFileName] = useState('');
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportModalFullscreen, setReportModalFullscreen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reportModalRef = useRef<HTMLDivElement>(null);

  const clearReport = () => {
    setReportUrl(null);
    setReportBlob(null);
    setReportModalOpen(false);
    setReportModalFullscreen(false);
  };

  useEffect(() => {
    return () => {
      if (reportUrl?.startsWith('blob:')) URL.revokeObjectURL(reportUrl);
    };
  }, [reportUrl]);

  const closeReportModal = async () => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch (cause) {
        console.error('Failed to exit report fullscreen:', cause);
      }
    }
    setReportModalOpen(false);
    setReportModalFullscreen(false);
  };

  const toggleReportFullscreen = async () => {
    if (!reportModalRef.current) return;

    if (reportModalFullscreen) {
      if (document.fullscreenElement) {
        try {
          await document.exitFullscreen();
        } catch (cause) {
          console.error('Failed to exit report fullscreen:', cause);
        }
      }
      setReportModalFullscreen(false);
      return;
    }

    try {
      if (typeof reportModalRef.current.requestFullscreen === 'function') {
        await reportModalRef.current.requestFullscreen();
      }
      setReportModalFullscreen(true);
    } catch (cause) {
      console.warn('Fullscreen API is unavailable; using the in-app fullscreen layout.', cause);
      setReportModalFullscreen(true);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setReportModalFullscreen(Boolean(document.fullscreenElement));
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !reportModalOpen) return;
      if (reportModalFullscreen) {
        if (!document.fullscreenElement) setReportModalFullscreen(false);
        return;
      }
      if (!document.fullscreenElement) {
        void closeReportModal();
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [reportModalOpen, reportModalFullscreen]);

  // Set default status filter when reportType changes
  useEffect(() => {
    if (reportType === 'skor-per-instansi' || reportType === 'aktivitas-per-instansi' || reportType === 'rekap-tpp-aktivitas') {
      setStatusFilter('pns');
    } else {
      setStatusFilter('all');
    }
  }, [reportType]);

  // Load employee database and extract unique instansi
  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      try {
        setLoadingPegawai(true);
        const pegawaiSearchList = await loadPegawaiSearchList();
        if (cancelled) return;
        setPegawaiList(pegawaiSearchList);

        // Pre-select logged-in employee if exists
        if (config.idPegawai) {
          const loggedIn = pegawaiSearchList.find((p: any) => p.id === config.idPegawai);
          if (loggedIn) {
            setSelectedPegawai(loggedIn);
          }
        }

        // Load OPD list
        let opdData: any[] = [];
        try {
          opdData = await loadOpdList();
        } catch {
          opdData = OPD_LIST || [];
        }
        const listInstansi: InstansiSelection[] = (opdData || []).map((item: any) => ({
          kode: item.kode,
          nama: item.nama
        }));

        setInstansiList(listInstansi);

        // Pre-select current instansi of logged-in employee
        const userInstCode = config.kodeInstansi || config.kodeUnor;
        if (userInstCode) {
          const found = listInstansi.find(i => i.kode === userInstCode);
          if (found) {
            setSelectedInstansi(found);
            setManualInstansiId(found.kode);
          } else {
            setManualInstansiId(userInstCode);
          }
        } else {
          setManualInstansiId('5.19.00.00.00');
        }

      } catch (err) {
        console.error("Error preparing report lists:", err);
      } finally {
        if (!cancelled) setLoadingPegawai(false);
      }
    };

    void loadData();
    return () => { cancelled = true; };
  }, [config.idPegawai, config.kodeInstansi, config.kodeUnor]);

  // Filter lists based on search
  const filteredInstansi = instansiList.filter(i => 
    i.nama.toLowerCase().includes(searchInstansi.toLowerCase()) || 
    i.kode.toLowerCase().includes(searchInstansi.toLowerCase())
  );

  // Generate Report URL
  const handleGenerateReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setReportUrl(null);
    setReportBlob(null);
    setReportModalOpen(false);
    setReportModalFullscreen(false);

    // Validate
    if (reportType === 'per-pegawai' || reportType === 'per-pegawai-aktivitas') {
      if (!selectedPegawai) {
        setError('Silakan pilih Pegawai terlebih dahulu.');
        return;
      }
    } else {
      const activeInstId = selectedInstansi ? selectedInstansi.kode : manualInstansiId;
      if (!activeInstId.trim()) {
        setError('Silakan tentukan atau pilih Kode Instansi terlebih dahulu.');
        return;
      }
    }

    setGenerating(true);

    try {
      const params = new URLSearchParams({
        reportType,
        t1: dateStart,
        t2: dateEnd,
        format: reportFormat
      });

      if (reportType === 'per-pegawai' || reportType === 'per-pegawai-aktivitas') {
        params.append('idp', selectedPegawai!.id);
      } else {
        const activeInstId = selectedInstansi ? selectedInstansi.kode : manualInstansiId;
        params.append('idu', activeInstId.trim());
        params.append('status', statusFilter);
      }

      const mime = reportFormat === 'xls' ? 'application/vnd.ms-excel' : 'application/pdf';
      let fileBlob: Blob;
      if (isTauri()) {
        const reportDataUrl = await fetchReport(params.toString());
        // fetchReport mengembalikan data URL; ambil bagian base64 agar valid untuk atob
        const b64 = reportDataUrl.includes('base64,')
          ? reportDataUrl.split('base64,')[1] || ''
          : reportDataUrl;
        const cleanB64 = b64.replace(/\s/g, '');
        if (!cleanB64) throw new Error('Data laporan kosong atau tidak valid.');
        const binary = atob(cleanB64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        fileBlob = new Blob([bytes.buffer], { type: mime });
      } else {
        const reportUrl = await fetchReport(params.toString());
        const response = await fetch(reportUrl);
        if (!response.ok) {
          const responseText = await response.text();
          let message = `Gagal memuat laporan (HTTP ${response.status}).`;
          try {
            const body = JSON.parse(responseText) as { error?: string };
            if (body.error) message = body.error;
          } catch {
            if (responseText.trim()) message = responseText.slice(0, 300);
          }
          throw new Error(message);
        }
        fileBlob = new Blob([await response.arrayBuffer()], { type: mime });
      }

      if (reportFormat === 'pdf') {
        const bytes = new Uint8Array(await fileBlob.slice(0, 5).arrayBuffer());
        const signature = new TextDecoder().decode(bytes);
        if (signature !== '%PDF-') throw new Error('Server tidak mengembalikan berkas PDF yang valid.');
      }

      const fileName = `${reportType}-${dateStart}-ke-${dateEnd}.${reportFormat}`;
      setReportFileName(fileName);
      setReportBlob(fileBlob);
      setReportUrl(URL.createObjectURL(fileBlob));
      setReportModalOpen(true);
      toast.success('Laporan berhasil dibuat. Pratinjau siap dibuka.');
    } catch (err: any) {
      const msg = err?.message || 'Terjadi kesalahan saat memformulasikan report.';
      setError(msg);
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveReport = async () => {
    if (!reportBlob) return;
    try {
      const mimeHint = reportFormat === 'xls' ? 'application/vnd.ms-excel' : 'application/pdf';
      await saveBlobSmart({
        blob: reportBlob,
        filename: reportFileName || `laporan.${reportFormat}`,
        mimeHint,
        showToast: (message, opts) => toast.success(message, opts),
        successMessage: 'Laporan berhasil disimpan.',
      });
    } catch (e: any) {
      toast.error(e?.message || 'Gagal menyimpan laporan.');
    }
  };

  if (!pegawai) {
    return null; // App.tsx auto-redirect ke tabBeranda
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="grid grid-cols-1 gap-6">
        <div className="space-y-6">
          <form onSubmit={handleGenerateReport} className="bg-white dark:bg-slate-800 p-5 sm:p-6 rounded-3xl border border-slate-200 dark:border-slate-700/60 shadow-sm space-y-5">
            <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-200 border-b border-slate-100 dark:border-slate-700 pb-3 flex items-center gap-2">
              <span>⚙️</span> Konfigurasi Parameter Laporan
            </h3>

            {/* Parameter 1: Report Type Selection */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                Jenis Laporan
              </label>
              <div className="grid grid-cols-1 gap-2">
                {canReport.perPegawai && (
                  <button
                    type="button"
                    onClick={() => { setReportType('per-pegawai'); clearReport(); }}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-all flex items-start gap-3 cursor-pointer ${reportType === 'per-pegawai' ? 'border-blue-500 bg-blue-50/30 dark:bg-blue-950/10 text-slate-800 dark:text-white font-bold ring-1 ring-blue-500' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
                  >
                    <FileText className={`w-5 h-5 shrink-0 mt-0.5 ${reportType === 'per-pegawai' ? 'text-blue-500' : 'text-slate-400'}`} />
                    <div>
                      <span className="block text-xs font-bold">1. Laporan Absensi Pegawai</span>
                      <span className="block text-[10px] text-slate-400 dark:text-slate-500 font-normal mt-0.5">Rekapitulasi total presensi masuk, pulang, izin per individu.</span>
                    </div>
                  </button>
                )}

                {canReport.perPegawaiAktivitas && (
                  <button
                    type="button"
                    onClick={() => { setReportType('per-pegawai-aktivitas'); clearReport(); }}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-all flex items-start gap-3 cursor-pointer ${reportType === 'per-pegawai-aktivitas' ? 'border-blue-500 bg-blue-50/30 dark:bg-blue-950/10 text-slate-800 dark:text-white font-bold ring-1 ring-blue-500' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
                  >
                    <FileCheck className={`w-5 h-5 shrink-0 mt-0.5 ${reportType === 'per-pegawai-aktivitas' ? 'text-blue-500' : 'text-slate-400'}`} />
                    <div>
                      <span className="block text-xs font-bold">2. Laporan Aktivitas Pegawai</span>
                      <span className="block text-[10px] text-slate-400 dark:text-slate-500 font-normal mt-0.5">Detail isian log aktivitas pekerjaan harian yang dilaporkan.</span>
                    </div>
                  </button>
                )}

                {canReport.skorPerInstansi && (
                  <button
                    type="button"
                    onClick={() => { setReportType('skor-per-instansi'); clearReport(); }}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-all flex items-start gap-3 cursor-pointer ${reportType === 'skor-per-instansi' ? 'border-blue-500 bg-blue-50/30 dark:bg-blue-950/10 text-slate-800 dark:text-white font-bold ring-1 ring-blue-500' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
                  >
                    <BarChart3 className={`w-5 h-5 shrink-0 mt-0.5 ${reportType === 'skor-per-instansi' ? 'text-blue-500' : 'text-slate-400'}`} />
                    <div>
                      <span className="block text-xs font-bold">3. Rekap Persentase Disiplin Kerja</span>
                      <span className="block text-[10px] text-slate-400 dark:text-slate-500 font-normal mt-0.5">Skor kedisiplinan dan persentase kehadiran pegawai per instansi (Pusat).</span>
                    </div>
                  </button>
                )}

                {canReport.aktivitasPerInstansi && (
                  <button
                    type="button"
                    onClick={() => { setReportType('aktivitas-per-instansi'); clearReport(); }}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-all flex items-start gap-3 cursor-pointer ${reportType === 'aktivitas-per-instansi' ? 'border-blue-500 bg-blue-50/30 dark:bg-blue-950/10 text-slate-800 dark:text-white font-bold ring-1 ring-blue-500' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
                  >
                    <Activity className={`w-5 h-5 shrink-0 mt-0.5 ${reportType === 'aktivitas-per-instansi' ? 'text-blue-500' : 'text-slate-400'}`} />
                    <div>
                      <span className="block text-xs font-bold">4. Rekap Persentase Produktivitas Kerja</span>
                      <span className="block text-[10px] text-slate-400 dark:text-slate-500 font-normal mt-0.5">Kumulatif isian log aktivitas pekerjaan harian pegawai per instansi (Pusat).</span>
                    </div>
                  </button>
                )}

                {canReport.rekapTppAktivitas && (
                  <button
                    type="button"
                    onClick={() => { setReportType('rekap-tpp-aktivitas'); clearReport(); }}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-all flex items-start gap-3 cursor-pointer ${reportType === 'rekap-tpp-aktivitas' ? 'border-blue-500 bg-blue-50/30 dark:bg-blue-950/10 text-slate-800 dark:text-white font-bold ring-1 ring-blue-500' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
                  >
                    <Coins className={`w-5 h-5 shrink-0 mt-0.5 ${reportType === 'rekap-tpp-aktivitas' ? 'text-blue-500' : 'text-slate-400'}`} />
                    <div>
                      <span className="block text-xs font-bold">5. Laporan Pembayaran TPP</span>
                      <span className="block text-[10px] text-slate-400 dark:text-slate-500 font-normal mt-0.5">Rekapitulasi TPP berdasarkan kehadiran dan log produktivitas per instansi.</span>
                    </div>
                  </button>
                )}
              </div>
            </div>

            {/* Parameter 1.5: Format Laporan Selection */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                Format Laporan
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setReportFormat('pdf');
                    clearReport();
                  }}
                  className={`px-4 py-2.5 rounded-2xl border text-xs font-bold transition-all text-center cursor-pointer flex items-center justify-center gap-1.5 ${reportFormat === 'pdf' ? 'border-red-500 bg-red-50/20 text-red-700 dark:text-red-400 font-extrabold ring-1 ring-red-500' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
                >
                  <span className="text-red-500">📄</span> Dokumen PDF
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReportFormat('xls');
                    clearReport();
                  }}
                  className={`px-4 py-2.5 rounded-2xl border text-xs font-bold transition-all text-center cursor-pointer flex items-center justify-center gap-1.5 ${reportFormat === 'xls' ? 'border-emerald-500 bg-emerald-50/20 text-emerald-700 dark:text-emerald-400 font-extrabold ring-1 ring-emerald-500' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
                >
                  <span className="text-emerald-500">📊</span> Excel Spreadsheet
                </button>
              </div>
            </div>

            {/* Parameter 2: Pegawai Selection Dropdown (Only for type 1 and 2) */}
            {(reportType === 'per-pegawai' || reportType === 'per-pegawai-aktivitas') && (
              <div className="space-y-2 relative" ref={pegawaiDropdownRef}>
                <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  {canSearchLaporan ? 'Pilih Pegawai' : 'Pegawai (Terkunci)'}
                </label>
                
                {canSearchLaporan ? (
                <>
                {/* Custom Searchable Input Select */}
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                    <Users className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={searchPegawai}
                    onChange={(e) => {
                      setSearchPegawai(e.target.value);
                      setShowPegawaiDropdown(true);
                    }}
                    onFocus={() => setShowPegawaiDropdown(true)}
                    placeholder={selectedPegawai ? `${selectedPegawai.nama} (${selectedPegawai.nip})` : "Cari nama atau NIP pegawai..."}
                    className="w-full bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white placeholder-slate-400 border border-slate-200 dark:border-slate-700 rounded-2xl pl-10 pr-10 py-3 text-xs font-bold focus:outline-none focus:border-blue-500"
                  />
                  {selectedPegawai && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPegawai(null);
                        setSearchPegawai('');
                      }}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                    >
                      <span className="text-[10px] font-bold bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded-md">Batal</span>
                    </button>
                  )}
                </div>

                {/* Dropdown Options List */}
                {showPegawaiDropdown && (
                  <div className="absolute left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl z-30 divide-y divide-slate-100 dark:divide-slate-700/50">
                      {loadingPegawai ? (
                        <div className="p-4 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Memuat database pegawai...
                        </div>
                      ) : filteredPegawai.length === 0 ? (
                        <div className="p-4 text-center text-slate-400 text-xs">
                          Pegawai tidak ditemukan.
                        </div>
                      ) : (
                        filteredPegawai.slice(0, 10).map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setSelectedPegawai(p);
                              setSearchPegawai('');
                              setShowPegawaiDropdown(false);
                              clearReport();
                            }}
                            className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer block"
                          >
                            <span className="block text-xs font-bold text-slate-800 dark:text-slate-100">{p.nama}</span>
                            <span className="block text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">NIP: {p.nip} {p.nama_instansi ? `• ${p.nama_instansi}` : ''}</span>
                          </button>
                        ))
                      )}
                      {filteredPegawai.length > 10 && (
                        <div className="p-2 bg-slate-50 dark:bg-slate-900/40 text-center text-[9px] text-slate-400 font-medium">
                          Menampilkan 10 hasil teratas dari total {filteredPegawai.length} pegawai. Gunakan pencarian lebih spesifik.
                        </div>
                      )}
                    </div>
                )}
                </>
                ) : null}

                {/* Selected Pegawai Card */}
                {selectedPegawai && (
                  <div className="p-3 bg-blue-50/40 dark:bg-slate-900/30 border border-blue-100/50 dark:border-slate-700/50 rounded-2xl mt-2 space-y-1">
                    <span className="text-[10px] font-bold text-blue-500 dark:text-blue-400 uppercase tracking-wide block">
                      {canSearchLaporan ? 'Terpilih:' : 'Akun Anda:'}
                    </span>
                    <span className="text-xs font-extrabold block text-slate-700 dark:text-slate-200">{selectedPegawai.nama}</span>
                    <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 block">NIP: {selectedPegawai.nip}</span>
                    {selectedPegawai.nama_instansi && (
                      <span className="text-[10px] text-slate-400 block truncate">Unit: {selectedPegawai.nama_instansi}</span>
                    )}
                    {!canSearchLaporan && (
                      <span className="text-[9px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded mt-1 inline-block">TERKUNCI KE AKUN SENDIRI</span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Parameter 2: Instansi/OPD Selection Dropdown */}
            {(reportType === 'skor-per-instansi' || reportType === 'aktivitas-per-instansi' || reportType === 'rekap-tpp-aktivitas') && (
              <div className="space-y-4">
                <div className="space-y-2 relative" ref={instansiDropdownRef}>
                  <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    {canSearchLaporan ? 'Pilih Perangkat Daerah (OPD)' : 'Instansi (Terkunci)'}
                  </label>

                  {canSearchLaporan ? (
                  <>
                  {/* Searchable input */}
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                      <Building2 className="w-4 h-4" />
                    </div>
                    <input
                      type="text"
                      value={searchInstansi}
                      onChange={(e) => {
                        setSearchInstansi(e.target.value);
                        setShowInstansiDropdown(true);
                      }}
                      onFocus={() => setShowInstansiDropdown(true)}
                      placeholder={selectedInstansi ? selectedInstansi.nama : "Cari nama instansi/OPD..."}
                      className="w-full bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white placeholder-slate-400 border border-slate-200 dark:border-slate-700 rounded-2xl pl-10 pr-10 py-3 text-xs font-bold focus:outline-none focus:border-blue-500"
                    />
                    {selectedInstansi && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedInstansi(null);
                          setSearchInstansi('');
                        }}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                      >
                        <span className="text-[10px] font-bold bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded-md">Batal</span>
                      </button>
                    )}
                  </div>

                  {/* Instansi Dropdown options */}
                  {showInstansiDropdown && (
                    <div className="absolute left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl z-30 divide-y divide-slate-100 dark:divide-slate-700/50 custom-scrollbar">
                        {filteredInstansi.length === 0 ? (
                          <div className="p-4 text-center text-slate-400 text-xs">
                            Instansi tidak ditemukan.
                          </div>
                        ) : (
                          filteredInstansi.slice(0, 50).map((i) => (
                            <button
                              key={i.kode}
                              type="button"
                              onClick={() => {
                                setSelectedInstansi(i);
                                setManualInstansiId(i.kode);
                                setSearchInstansi('');
                                setShowInstansiDropdown(false);
                                clearReport();
                              }}
                              className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer block"
                            >
                              <span className="block text-xs font-bold text-slate-800 dark:text-slate-100">{i.nama}</span>
                              <span className="block text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 font-mono">IDU: {i.kode}</span>
                            </button>
                          ))
                        )}
                      </div>
                  )}
                  </>
                  ) : (
                    /* Terkunci ke instansi sendiri */
                    <div className="flex items-center gap-2 py-3 px-4 bg-slate-100 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 rounded-2xl">
                      <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">
                          {selectedInstansi ? selectedInstansi.nama : (manualInstansiId || 'Instansi Anda')}
                        </p>
                        <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400">IDU: {manualInstansiId || '-'}</p>
                      </div>
                      <span className="text-[9px] font-bold bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded shrink-0">TERKUNCI</span>
                    </div>
                  )}
                </div>

                {/* Manual Code Input Field - hanya tampil jika ada izin cari */}
                {canSearchLaporan && (
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase">
                    Kode Instansi Pusat (IDU)
                  </label>
                  <input
                    type="text"
                    value={manualInstansiId}
                    onChange={(e) => {
                      setManualInstansiId(e.target.value);
                      setSelectedInstansi(null); // Clear preset if edited manually
                      clearReport();
                    }}
                    placeholder="Contoh: 5.19.00.00.00"
                    className="w-full bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2 text-xs font-mono font-semibold focus:outline-none focus:border-blue-500"
                  />
                  <span className="text-[9px] text-slate-400 block leading-relaxed">
                    *IDU default didasarkan pada Kode Instansi unit kerja Anda di server pusat.
                  </span>
                </div>
                )}

                 {/* Status Selection Filter */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase">
                    Status Filter Rekap
                  </label>
                  <Dropdown
                    value={statusFilter}
                    onChange={(v) => {
                      setStatusFilter(v);
                      clearReport();
                    }}
                    opsi={[
                      { value: 'pns', label: 'Pegawai Negeri Sipil (PNS)' },
                      { value: 'non_pns', label: 'Non-PNS (PTT / Kontrak / Lainnya)' },
                    ]}
                    placeholder="Pilih status pegawai"
                    aria-label="Status Filter Rekap"
                  />
                </div>
              </div>
            )}

            {/* Parameter 3: Date Picker Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DatePicker
                label="Tanggal Mulai"
                value={dateStart}
                onChange={(date) => {
                  setDateStart(date);
                  clearReport();
                }}
              />
              <DatePicker
                label="Tanggal Akhir"
                value={dateEnd}
                onChange={(date) => {
                  setDateEnd(date);
                  clearReport();
                }}
              />
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={generating}
              className={`w-full text-white py-3.5 px-4 rounded-2xl text-xs font-extrabold tracking-wide transition-all shadow-md cursor-pointer flex items-center justify-center gap-2 ${reportFormat === 'xls' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/10' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/10'}`}
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Memformulasikan Report...
                </>
              ) : (
                <>
                  {reportFormat === 'xls' ? (
                    <>
                      <span>📊</span> Generate Report Excel
                    </>
                  ) : (
                    <>
                      <span>📄</span> Generate Report PDF
                    </>
                  )}
                </>
              )}
            </button>
          </form>

          {reportUrl && reportBlob && !reportModalOpen && (
            <div className="flex min-h-[180px] flex-col items-center justify-center gap-4 rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-700/60 dark:bg-slate-800">
              <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${
                reportFormat === 'xls'
                  ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400'
                  : 'bg-rose-50 text-rose-600 dark:bg-rose-950/20 dark:text-rose-400'
              }`}>
                {reportFormat === 'xls' ? <FileSpreadsheet className="h-7 w-7" /> : <FileText className="h-7 w-7" />}
              </div>
              <div>
                <h4 className="text-sm font-extrabold text-slate-800 dark:text-white">Laporan siap dibuka</h4>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{reportFileName}</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setReportModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-blue-700"
                >
                  {reportFormat === 'xls' ? <FileSpreadsheet className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                  Buka Pratinjau
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveReport()}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <Download className="h-4 w-4" />
                  Simpan / Unduh
                </button>
              </div>
            </div>
          )}

          {!reportUrl && !error && (
            <div className="bg-slate-100 dark:bg-slate-800/20 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl p-8 text-center flex flex-col items-center justify-center min-h-[200px]">
              <div className="w-16 h-16 rounded-3xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700 text-slate-400 flex items-center justify-center shadow-xs">
                <FileText className="w-8 h-8" />
              </div>
              <h4 className="text-sm font-extrabold text-slate-700 dark:text-slate-300 mt-4">Belum Ada Laporan yang Di-generate</h4>
            </div>
          )}

          {/* Inline Error block */}
          {error && (
            <div className="bg-rose-50 dark:bg-rose-950/15 p-4 rounded-3xl border border-rose-100 dark:border-rose-900/30 text-rose-800 dark:text-rose-400 flex items-start gap-3 mt-4 animate-in fade-in duration-200">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="text-xs">
                <span className="font-bold block">Gagal Menyiapkan Laporan:</span>
                <span className="mt-1 block text-slate-500 dark:text-slate-400 leading-relaxed">{error}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {reportModalOpen && reportBlob && reportUrl && (
        <div
          className={`report-modal-overlay modal-layer fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 ${
            reportModalFullscreen ? 'modal-fullscreen is-fullscreen p-0' : 'p-2 sm:p-4'
          }`}
          role="dialog"
          aria-modal="true"
          aria-label={`Pratinjau laporan ${reportFormat === 'pdf' ? 'PDF' : 'spreadsheet'}`}
        >
          <div
            ref={reportModalRef}
            className={`report-viewer-panel relative flex w-full flex-col overflow-hidden border border-slate-200/60 bg-white shadow-2xl dark:border-slate-700/60 dark:bg-slate-900 ${
              reportModalFullscreen
                ? 'report-viewer-panel-fullscreen fixed inset-0 z-[101] h-[100dvh] max-w-none rounded-none'
                : 'h-[88dvh] max-w-6xl rounded-2xl sm:rounded-3xl'
            }`}
            style={reportModalFullscreen ? { paddingTop: 'var(--sat, env(safe-area-inset-top, 0px))', paddingBottom: 'var(--sab, env(safe-area-inset-bottom, 0px))' } : undefined}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/80 sm:gap-3 sm:px-4 sm:py-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${reportFormat === 'xls' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                <span className="truncate text-[11px] font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                  {reportType.replace(/-/g, ' ')}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => void toggleReportFullscreen()}
                  className="inline-flex items-center gap-1.5 bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  aria-label={reportModalFullscreen ? 'Keluar dari layar penuh' : 'Layar penuh'}
                >
                  {reportModalFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  <span className="hidden sm:inline">{reportModalFullscreen ? 'Keluar layar penuh' : 'Layar penuh'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => void closeReportModal()}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  aria-label="Tutup laporan"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <ReportDocumentPreview file={reportBlob} format={reportFormat} />
          </div>
        </div>
      )}

    </div>
  );
}

export default function Laporan() {
  const { serverProfile } = useAppContext();
  if (serverProfile?.mode === 'ponorogo-absensi') {
    return <PonorogoLaporanPage />;
  }
  return <BkdLaporan />;
}
