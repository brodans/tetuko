import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ImageLightbox from '../components/ui/ImageLightbox';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Monitor, Cpu, UserSquare2, FileText, LogIn, LogOut, RefreshCw,
  ChevronLeft, ChevronRight, Map, Eye, EyeOff, Download, X, Copy, Check,
  CheckCircle2, AlertCircle, Loader2, Shield,
} from 'lucide-react';
import {
  ambilBerkas, ambilDetailPegawai, ambilIjinPegawai, ambilImei, ambilKehadiran,
  ambilLatlong, ambilPerizinan, login, logout, muatCaptcha,
  urlBerkas, setWebPresensiEpBase,
  type BarisIjin, type BarisKehadiran, type DetailPegawai, type HasilImei,
  type HasilKehadiran, type HasilPerizinan,
} from '../lib/webPresensi';
import { useAppContext, type WebPresensiTab } from '../context/AppContext';

import { useToast } from '../components/ui/Toast';
import { saveBlobSmart } from '../lib/nativeSave';



function sesiKey(profileId: string) { return `portal:web-presensi-session:${profileId}`; }

interface SesiWebTersimpan {
  versi: 1; username: string; nip: string; hasilImei: HasilImei; tab: WebPresensiTab;
}

function hapusSesiWeb(profileId: string) {
  try { sessionStorage.removeItem(sesiKey(profileId)); } catch {}
}

function bacaSesiWeb(username: string, profileId: string): SesiWebTersimpan | null {
  try {
    const raw = sessionStorage.getItem(sesiKey(profileId));
    if (!raw) return null;
    const nilai: any = JSON.parse(raw);
    if (!nilai || nilai.versi !== 1 || nilai.username !== username || typeof nilai.nip !== 'string') {
      hapusSesiWeb(profileId); return null;
    }
    const hasil = nilai.hasilImei;
    if (!hasil || typeof hasil !== 'object') { hapusSesiWeb(profileId); return null; }
    const profil = hasil.profil;
    const profilValid = profil === null || (typeof profil === 'object' && typeof profil.nip === 'string');
    if (!profilValid) { hapusSesiWeb(profileId); return null; }
    const allowedTabs = ['imei', 'kehadiran', 'detail', 'perizinan'];
    if (!allowedTabs.includes(String(nilai.tab))) { hapusSesiWeb(profileId); return null; }
    return { versi: 1, username, nip: nilai.nip, hasilImei: { imei: hasil.imei ?? null, profil: profil ?? null }, tab: nilai.tab };
  } catch { hapusSesiWeb(profileId); return null; }
}

function adaSesiWebTersimpan(username: string, profileId: string): boolean {
  if (!username) return false;
  try { return !!bacaSesiWeb(username, profileId); } catch { return false; }
}

function formatTanggal(raw: string): string {
  if (!raw || raw === '—') return raw;
  const bersih = raw.trim();
  const isoM = bersih.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoM) return `${isoM[3].padStart(2,'0')}/${isoM[2].padStart(2,'0')}/${isoM[1]}`;
  const dmyM = bersih.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyM) return `${dmyM[1].padStart(2,'0')}/${dmyM[2].padStart(2,'0')}/${dmyM[3]}`;
  return bersih;
}
function pisahWaktu(raw: string): { tanggal: string; jam: string } {
  if (!raw || !raw.trim() || raw.trim() === '—') return { tanggal: '—', jam: '' };
  const bersih = raw.trim();
  if (bersih.includes('T')) {
    const [tglPart, jamPart] = bersih.split('T');
    return { tanggal: formatTanggal(tglPart), jam: jamPart.replace(/\.\d+Z?$/, '') };
  }
  const spaceIdx = bersih.search(/\s+/);
  if (spaceIdx > 0) {
    const tglPart = bersih.slice(0, spaceIdx).trim();
    const jamPart = bersih.slice(spaceIdx).trim();
    if (/^\d{1,2}:\d{2}/.test(jamPart)) return { tanggal: formatTanggal(tglPart), jam: jamPart };
    const bagian = bersih.split(/\s+/);
    const jamKandidat = bagian[bagian.length - 1];
    if (/^\d{1,2}:\d{2}/.test(jamKandidat)) return { tanggal: formatTanggal(bagian.slice(0, -1).join(' ')), jam: jamKandidat };
    return { tanggal: formatTanggal(bersih), jam: '' };
  }
  return { tanggal: formatTanggal(bersih), jam: '' };
}
function CellWaktu({ nilai }: { nilai: string }) {
  const { tanggal, jam } = pisahWaktu(nilai);
  if (tanggal === '—' && !jam) return <span className="text-slate-400 dark:text-slate-500 text-xs">—</span>;
  return (
    <div>
      <div className="font-mono text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">{tanggal}</div>
      {jam && <div className="font-mono text-[11px] text-slate-400 dark:text-slate-500 whitespace-nowrap">{jam}</div>}
    </div>
  );
}
function Lencana({ nilai, ya = 'Disetujui', tidak = 'Ditolak' }: { nilai: boolean | null; ya?: string; tidak?: string }) {
  if (nilai === true) return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"><Check className="w-3 h-3" />{ya}</span>;
  if (nilai === false) return <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"><X className="w-3 h-3" />{tidak}</span>;
  return <span className="text-slate-400 dark:text-slate-500 text-xs">—</span>;
}
function Pesan({ tipe, children }: { tipe: 'info' | 'error' | 'sukses'; children: React.ReactNode }) {
  const kelas = {
    info: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800/40',
    error: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-800/40',
    sukses: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800/40',
  }[tipe];
  return <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${kelas}`}><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span>{children}</span></div>;
}
function SkeletonBaris({ cols = 6 }: { cols?: number }) {
  return <tr className="animate-pulse">{[...Array(cols)].map((_, i) => <td key={i} className="px-3 py-2.5"><div className="h-3.5 rounded bg-slate-200 dark:bg-slate-700" style={{ width: `${55 + (i * 13) % 40}%` }} /></td>)}</tr>;
}

type ModalProps = { judul: string; onTutup: () => void; children: React.ReactNode; lebar?: boolean; kotak?: boolean; mediaMod?: boolean; };
function Modal({ judul, onTutup, children, lebar = false, kotak = false, mediaMod = false }: ModalProps) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setVisible(true)); return () => cancelAnimationFrame(t); }, []);
  function tutup() { setVisible(false); setTimeout(onTutup, 180); }
  useEffect(() => {
    function esc(e: KeyboardEvent) { if (e.key === 'Escape') tutup(); }
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const maxW = lebar ? 'max-w-4xl' : kotak ? 'max-w-sm' : 'max-w-lg';
  return createPortal(
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 transition-all duration-150 ${visible ? 'bg-black/40' : 'bg-black/0'}`} onClick={tutup} role="presentation">
      <div className={`relative bg-white dark:bg-slate-900 rounded-2xl flex flex-col max-h-[92vh] w-full ${maxW} border border-slate-200/80 dark:border-slate-700/80 shadow-2xl shadow-black/20 dark:shadow-black/60 transition-all duration-200 ease-out ${visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-[0.97] translate-y-2'}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={judul}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate pr-4">{judul}</h3>
          <button type="button" onClick={tutup} className="shrink-0 rounded-lg p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors" aria-label="Tutup"><X className="w-4 h-4" /></button>
        </div>
        <div className={`overflow-y-auto flex-1 ${mediaMod ? 'p-0' : 'p-5'}`}>{children}</div>
      </div>
    </div>,
    document.body
  );
}

type BerkasState = { nama: string; url: string | null; tipe: string; loading: boolean; err: string };
function ViewerBerkas({ berkas, onTutup }: { berkas: BerkasState; onTutup: () => void }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const isPdf = /pdf/i.test(berkas.tipe);
  const isImage = /^image\//i.test(berkas.tipe);

  const simpanBerkas = async () => {
    if (!berkas.url) return;
    setSaving(true);
    try {
      const res = await fetch(berkas.url);
      if (!res.ok) throw new Error(`Gagal membaca berkas (HTTP ${res.status})`);
      const blob = await res.blob();
      await saveBlobSmart({
        blob,
        filename: berkas.nama || 'berkas',
        mimeHint: berkas.tipe || blob.type,
        showToast: (message, opts) => toast.success(message, opts),
        successMessage: 'Berkas berhasil disimpan.',
      });
    } catch (e: any) {
      toast.error(e?.message || 'Gagal menyimpan berkas.');
    } finally {
      setSaving(false);
    }
  };

  if (berkas.loading || berkas.err || !berkas.url) {
    return (
      <Modal judul={berkas.nama} onTutup={onTutup} lebar>
        {berkas.loading && <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /><span className="text-sm">Memuat berkas...</span></div>}
        {berkas.err && <div className="p-5"><Pesan tipe="error">{berkas.err}</Pesan></div>}
      </Modal>
    );
  }

  if (isImage) {
    // ImageLightbox sudah memiliki tombol simpan native-aware; tetap sediakan fallback aksi via long-press UI di sana.
    return <ImageLightbox src={berkas.url} title={berkas.nama} onClose={onTutup} />;
  }

  if (isPdf) {
    return (
      <Modal judul={berkas.nama} onTutup={onTutup} lebar mediaMod>
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
          <button
            type="button"
            onClick={() => void simpanBerkas()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-3 py-1.5 text-xs font-semibold transition-colors"
          >
            <Download className={`w-4 h-4 ${saving ? 'animate-pulse' : ''}`} />
            {saving ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
        <iframe src={berkas.url} title={berkas.nama} className="w-full rounded-b-2xl" style={{ height: '78vh', border: 'none' }} />
      </Modal>
    );
  }

  return (
    <Modal judul={berkas.nama} onTutup={onTutup} lebar>
      <div className="p-5 space-y-3">
        <Pesan tipe="info">Pratinjau tidak tersedia untuk tipe: {berkas.tipe || 'tidak diketahui'}.</Pesan>
        <button
          type="button"
          onClick={() => void simpanBerkas()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
        >
          <Download className={`w-4 h-4 ${saving ? 'animate-pulse' : ''}`} />
          {saving ? 'Menyimpan...' : 'Simpan berkas'}
        </button>
      </div>
    </Modal>
  );
}

function Peta({ lat, lng, judul }: { lat: number; lng: number; judul?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<ReturnType<typeof L.map> | null>(null);
  const markerRef = useRef<ReturnType<typeof L.circleMarker> | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const map = L.map(el, { zoomControl: true }).setView([lat, lng], 17);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    const marker = L.circleMarker([lat, lng], { radius: 9, color: '#4f46e5', weight: 3, fillColor: '#4f46e5', fillOpacity: 0.5 }).addTo(map).bindPopup(judul || 'Lokasi presensi').openPopup();
    mapRef.current = map; markerRef.current = marker;
    let rafId: number;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(() => map.invalidateSize()); });
    ro.observe(el);
    const t = setTimeout(() => map.invalidateSize(), 50);
    return () => { clearTimeout(t); cancelAnimationFrame(rafId); ro.disconnect(); map.remove(); mapRef.current = null; markerRef.current = null; };
  }, []);
  useEffect(() => {
    const map = mapRef.current; const marker = markerRef.current; if (!map || !marker) return;
    marker.setLatLng([lat, lng]).bindPopup(judul || 'Lokasi presensi').openPopup();
    map.setView([lat, lng], map.getZoom(), { animate: false });
  }, [lat, lng, judul]);
  return <div ref={ref} className="aspect-square w-full rounded-b-2xl overflow-hidden" />;
}

function Paginasi({ halaman, totalHalaman, onPilih, disabled }: { halaman: number; totalHalaman: number; onPilih: (h: number) => void; disabled?: boolean }) {
  if (!totalHalaman || totalHalaman <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 mt-4">
      <button type="button" onClick={() => onPilih(halaman - 1)} disabled={disabled || halaman <= 1} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed dark:text-slate-400 dark:hover:bg-slate-800 transition-colors"><ChevronLeft className="w-4 h-4" />Sebelumnya</button>
      <span className="text-sm text-slate-500 dark:text-slate-400">{halaman} / {totalHalaman}</span>
      <button type="button" onClick={() => onPilih(halaman + 1)} disabled={disabled || halaman >= totalHalaman} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed dark:text-slate-400 dark:hover:bg-slate-800 transition-colors">Berikutnya<ChevronRight className="w-4 h-4" /></button>
    </div>
  );
}

function Tabel({ kolom, children, lebar }: { kolom: string[]; children: React.ReactNode; lebar?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
      <table className={`text-sm ${lebar || 'w-full'}`}>
        <thead><tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">{kolom.map((k) => <th key={k} className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 whitespace-nowrap">{k}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">{children}</tbody>
      </table>
    </div>
  );
}

export default function WebPresensi() {
  const { webPresensiState, setWebPresensiState, serverProfile, pegawai, loginForm } = useAppContext();
  const profileId = serverProfile.id || 'jatim';
  const username = String(pegawai?.nip || loginForm.username || profileId);
  const isBkdWebProfile = serverProfile.mode === 'bkd-rpc';
  const tampilDetail = isBkdWebProfile || profileId === 'jatim' || profileId === 'madiun';

  // set EP base for proxy routing
  useEffect(() => {
    setWebPresensiEpBase(serverProfile.epBaseUrl);
    return () => { /* keep last */ };
  }, [serverProfile.epBaseUrl]);

  const DAFTAR_TAB = useMemo(() => (
    tampilDetail
      ? [
          { id: 'imei' as const, label: 'IMEI', icon: Cpu },
          { id: 'detail' as const, label: 'Detail Pegawai', icon: UserSquare2 },
          { id: 'kehadiran' as const, label: 'Kehadiran', icon: Monitor },
          { id: 'perizinan' as const, label: 'Perizinan', icon: FileText },
        ]
      : [
          { id: 'imei' as const, label: 'IMEI', icon: Cpu },
          { id: 'kehadiran' as const, label: 'Kehadiran', icon: Monitor },
          { id: 'perizinan' as const, label: 'Perizinan', icon: FileText },
        ]
  ), [tampilDetail]);

  const sudahLogin = webPresensiState.sudahLogin;
  const hasilImei = webPresensiState.hasilImei as HasilImei | null;
  const tab = (DAFTAR_TAB.some(t => t.id === webPresensiState.tab) ? webPresensiState.tab : 'imei') as WebPresensiTab;
  const kehadiran = webPresensiState.kehadiran as HasilKehadiran | null;
  const detail = (webPresensiState as any).detail as DetailPegawai | null;
  const ijinAjax = (webPresensiState as any).ijinAjax as BarisIjin[] | null;
  const perizinan = webPresensiState.perizinan as HasilPerizinan | null;
  const semuaPerizinan = webPresensiState.semuaPerizinan as BarisIjin[] | null;

  const patch = useCallback((updates: Partial<typeof webPresensiState>) => setWebPresensiState((prev: any) => ({ ...prev, ...updates })), [setWebPresensiState]);
  const setSudahLogin = useCallback((v: boolean) => patch({ sudahLogin: v }), [patch]);
  const setPemilikSesi = useCallback((v: string | null) => patch({ pemilikSesi: v }), [patch]);
  const setHasilImei = useCallback((v: HasilImei | null) => patch({ hasilImei: v as any }), [patch]);
  const setTab = useCallback((v: WebPresensiTab) => patch({ tab: v }), [patch]);
  const setKehadiran = useCallback((v: HasilKehadiran | null) => patch({ kehadiran: v as any }), [patch]);
  const setDetail = useCallback((v: DetailPegawai | null) => patch({ detail: v as any }), [patch]);
  const setIjinAjax = useCallback((v: BarisIjin[] | null) => patch({ ijinAjax: v as any }), [patch]);
  const setPerizinan = useCallback((v: HasilPerizinan | null) => patch({ perizinan: v as any }), [patch]);
  const setSemuaPerizinan = useCallback((v: BarisIjin[] | null) => patch({ semuaPerizinan: v as any }), [patch]);

  const initialNip = String(pegawai?.nip || loginForm.username || '');
  const isBkdWeb = serverProfile.mode === 'bkd-rpc';
  const [nip, setNip] = useState(initialNip);
  const nipDiubahManual = useRef(false);
  const [password, setPassword] = useState(isBkdWeb ? initialNip : '');
  const passwordDiubahManual = useRef(false);
  const [lihatPassword, setLihatPassword] = useState(false);
  const [captcha, setCaptcha] = useState('');
  const [captchaImg, setCaptchaImg] = useState<string | null>(null);
  const [captchaInfo, setCaptchaInfo] = useState('');
  const [loadingCaptcha, setLoadingCaptcha] = useState(false);
  const [loadingProses, setLoadingProses] = useState(false);
  const [loadingLogout, setLoadingLogout] = useState(false);
  const [memulihkanSesi, setMemulihkanSesi] = useState(() => adaSesiWebTersimpan(username, profileId));
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [copied, setCopied] = useState('');
  const [kehadiranErr, setKehadiranErr] = useState('');
  const [kehadiranLoading, setKehadiranLoading] = useState(false);
  const [detailErr, setDetailErr] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [ijinAjaxErr, setIjinAjaxErr] = useState('');
  const [ijinAjaxLoading, setIjinAjaxLoading] = useState(false);
  const [perizinanErr, setPerizinanErr] = useState('');
  const [perizinanLoading, setPerizinanLoading] = useState(false);
  const [memuatSemua, setMemuatSemua] = useState(false);
  type PetaState = { judul: string; lat: number | null; lng: number | null; loading?: boolean; err: string; sumber?: string; alamat?: string };
  const [peta, setPeta] = useState<PetaState | null>(null);
  const [berkas, setBerkas] = useState<BerkasState | null>(null);

  const captchaRef = useRef('');
  const dimuatRef = useRef<any>(webPresensiState.dimuat || { kehadiran: false, detail: false, perizinan: false });
  useEffect(() => { dimuatRef.current = webPresensiState.dimuat || { kehadiran: false, detail: false, perizinan: false }; }, [webPresensiState.dimuat]);

  useEffect(() => {
    if (nipDiubahManual.current) return;
    const nextNip = String(pegawai?.nip || loginForm.username || '');
    setNip(nextNip);
    if (isBkdWeb && !passwordDiubahManual.current) {
      setPassword(nextNip);
    }
  }, [pegawai?.nip, loginForm.username, isBkdWeb]);

  function simpanCaptcha(nilai: string) { captchaRef.current = nilai; setCaptcha(nilai); }

  const refreshCaptcha = useCallback(async (alasan = '') => {
    setLoadingCaptcha(true); simpanCaptcha('');
    setCaptchaInfo(alasan || 'Memuat captcha...');
    try {
      const hasil = await muatCaptcha();
      setCaptchaImg(hasil.url);
      setCaptchaInfo((alasan ? alasan + ' ' : '') + 'Ketik kode captcha dari gambar di atas.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCaptchaImg(null);
      setCaptchaInfo(`Gagal memuat captcha — ${msg}. Klik ikon refresh untuk coba lagi.`);
    } finally {
      setLoadingCaptcha(false);
    }
    return '';
  }, []);

  const kosongkanData = useCallback(() => {
    setHasilImei(null); setKehadiran(null); setKehadiranErr(''); setDetail(null); setDetailErr('');
    setIjinAjax(null); setIjinAjaxErr(''); setPerizinan(null); setPerizinanErr(''); setSemuaPerizinan(null); setPeta(null);
    dimuatRef.current = { kehadiran: false, detail: false, perizinan: false };
    patch({ dimuat: { kehadiran: false, detail: false, perizinan: false } as any });
  }, [patch, setDetail, setHasilImei, setIjinAjax, setKehadiran, setPerizinan, setSemuaPerizinan]);

  type ApiError = Error & { sesiHabis?: boolean };

  const tanganiSesiHabis = useCallback(async (pesan = 'Sesi berakhir, silakan login ulang.') => {
    hapusSesiWeb(profileId);
    setSudahLogin(false); setPemilikSesi(null); kosongkanData(); setTab('imei');
    setError(pesan);
    await refreshCaptcha('Captcha baru dimuat.');
  }, [kosongkanData, profileId, refreshCaptcha, setPemilikSesi, setSudahLogin, setTab]);

  useEffect(() => {
    let hidup = true;
    if (sudahLogin && webPresensiState.pemilikSesi === username) { setMemulihkanSesi(false); return () => { hidup = false; }; }
    if (sudahLogin) {
      patch({ sudahLogin: false, pemilikSesi: null, hasilImei: null, tab: 'imei', kehadiran: null, detail: null, ijinAjax: null, perizinan: null, semuaPerizinan: null, dimuat: { kehadiran: false, detail: false, perizinan: false } as any });
    }
    const tersimpan = username ? bacaSesiWeb(username, profileId) : null;
    if (!tersimpan) {
      setMemulihkanSesi(false);
      if (!sudahLogin) void refreshCaptcha();
      return () => { hidup = false; };
    }
    setMemulihkanSesi(true); setError(''); setStatus('Memverifikasi sesi Web Presensi...');
    void ambilImei().then((hasil) => {
      if (!hidup) return;
      const hasilTerverifikasi = { ...hasil, profil: hasil.profil ?? tersimpan.hasilImei.profil ?? (tersimpan.nip ? { nama: '', nip: tersimpan.nip } : null) };
      setHasilImei(hasilTerverifikasi as any); setSudahLogin(true); setPemilikSesi(username);
      const nextTab = (!tampilDetail && tersimpan.tab === 'detail') ? 'imei' : tersimpan.tab;
      setTab(nextTab);
      dimuatRef.current = { kehadiran: false, detail: false, perizinan: false };
      patch({ dimuat: { kehadiran: false, detail: false, perizinan: false } as any });
    }).catch((e: unknown) => {
      if (!hidup) return;
      const err = e as ApiError;
      if (err.sesiHabis) hapusSesiWeb(profileId);
      setError(err.sesiHabis ? 'Sesi Web Presensi sudah berakhir. Silakan login kembali.' : `Gagal memverifikasi sesi Web Presensi: ${err.message}`);
      void refreshCaptcha();
    }).finally(() => { if (!hidup) return; setMemulihkanSesi(false); setStatus(''); });
    return () => { hidup = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, profileId]);

  useEffect(() => {
    if (!sudahLogin || !username || !hasilImei) return;
    const sesi: SesiWebTersimpan = { versi: 1, username, nip: hasilImei.profil?.nip ?? nip.trim(), hasilImei, tab };
    try { sessionStorage.setItem(sesiKey(profileId), JSON.stringify(sesi)); } catch (e) { console.warn('Gagal simpan sesi web presensi', e); }
  }, [sudahLogin, username, hasilImei, tab, nip, profileId]);

  const jalankan = useCallback(function jalankanImpl<T>(opts: { fn: () => Promise<T>; setData: (d: T) => void; setErr: (e: string) => void; setLoading: (b: boolean) => void; }) {
    const { fn, setData, setErr, setLoading } = opts;
    setErr(''); setLoading(true);
    return fn().then((data) => { setData(data); return data as T | null; })
      .catch(async (e: unknown) => { const err = e as ApiError; if (err.sesiHabis) await tanganiSesiHabis(err.message); else setErr(err.message); return null as T | null; })
      .finally(() => setLoading(false));
  }, [tanganiSesiHabis]);

  const muatKehadiran = useCallback((halaman = 1) => jalankan({ fn: () => ambilKehadiran({ halaman }), setData: setKehadiran, setErr: setKehadiranErr, setLoading: setKehadiranLoading }), [jalankan, setKehadiran]);
  const muatDetail = useCallback(() => jalankan({
    fn: async () => {
      const d = await ambilDetailPegawai();
      if (d.idPegawai) {
        setIjinAjaxErr(''); setIjinAjaxLoading(true);
        try { const ij = await ambilIjinPegawai(d.idPegawai); setIjinAjax(ij.baris); }
        catch (e) { const err = e as ApiError; if (err.sesiHabis) await tanganiSesiHabis(err.message); else setIjinAjaxErr(err.message); }
        finally { setIjinAjaxLoading(false); }
      }
      return d;
    }, setData: setDetail, setErr: setDetailErr, setLoading: setDetailLoading,
  }), [jalankan, setDetail, setIjinAjax, tanganiSesiHabis]);
  const muatPerizinan = useCallback((halaman = 1) => jalankan({ fn: () => ambilPerizinan({ halaman }), setData: setPerizinan, setErr: setPerizinanErr, setLoading: setPerizinanLoading }), [jalankan, setPerizinan]);

  const muatSemuaPerizinan = useCallback(async () => {
    setPerizinanErr(''); setMemuatSemua(true);
    try {
      const pertama = await ambilPerizinan({ halaman: 1 });
      let semua = [...pertama.baris];
      for (let p = 2; p <= pertama.totalHalaman; p++) {
        setStatus(`Memuat halaman ${p}/${pertama.totalHalaman}...`);
        semua = semua.concat((await ambilPerizinan({ halaman: p })).baris);
      }
      setSemuaPerizinan(semua);
      setStatus(`${semua.length} baris dari ${pertama.totalHalaman} halaman.`);
    } catch (e) { const err = e as ApiError; if (err.sesiHabis) await tanganiSesiHabis(err.message); else setPerizinanErr(err.message); }
    finally { setMemuatSemua(false); setTimeout(() => setStatus(''), 4000); }
  }, [setSemuaPerizinan, tanganiSesiHabis]);

  useEffect(() => {
    if (!sudahLogin) return;
    if (tab === 'kehadiran' && !dimuatRef.current.kehadiran) { dimuatRef.current.kehadiran = true; patch({ dimuat: { ...dimuatRef.current } as any }); void muatKehadiran(1); }
    if (tab === 'detail' && tampilDetail && !dimuatRef.current.detail) { dimuatRef.current.detail = true; patch({ dimuat: { ...dimuatRef.current } as any }); void muatDetail(); }
    if (tab === 'perizinan' && !dimuatRef.current.perizinan) { dimuatRef.current.perizinan = true; patch({ dimuat: { ...dimuatRef.current } as any }); void muatPerizinan(1); }
  }, [tab, sudahLogin, tampilDetail, muatKehadiran, muatDetail, muatPerizinan, patch]);

  async function proses(e: React.FormEvent) {
    e.preventDefault(); setError(''); setHasilImei(null); setLoadingProses(true);
    try {
      const kode = captchaRef.current.trim();
      if (!kode) { setError('Captcha belum terisi. Tunggu OCR selesai atau ketik manual.'); return; }
      await login({ nip: nip.trim(), password, captcha: kode });
      setPassword(''); passwordDiubahManual.current = false;
      setStatus('Mengambil IMEI...');
      const data = await ambilImei();
      setHasilImei(data as any); setSudahLogin(true); setPemilikSesi(username); setTab('imei');
      dimuatRef.current = { kehadiran: false, detail: false, perizinan: false };
      patch({ dimuat: { kehadiran: false, detail: false, perizinan: false } as any });
      setStatus(data.imei ? 'Selesai.' : 'Login berhasil, tidak ada IMEI.');
    } catch (err) {
      const ae = err as (Error & { sesiHabis?: boolean; perluCaptchaBaru?: boolean });
      setError(ae.message);
      if (ae.sesiHabis || ae.perluCaptchaBaru) await refreshCaptcha('Captcha baru dimuat.');
    } finally { setLoadingProses(false); setStatus(''); }
  }

  async function keluar() {
    setLoadingLogout(true);
    try { await logout(); } finally {
      hapusSesiWeb(profileId);
      setSudahLogin(false); setPemilikSesi(null); kosongkanData(); setTab('imei');
      setError(''); setStatus(''); setLoadingLogout(false);
      void refreshCaptcha();
    }
  }

  async function salin(nilai: string) {
    try { await navigator.clipboard.writeText(nilai); setCopied(nilai); setTimeout(() => setCopied(''), 1500); }
    catch { setError('Gagal menyalin ke clipboard.'); }
  }

  const bukaPeta = useCallback(async (row: BarisKehadiran) => {
    const judul = [row.nama, row.created_at].filter(Boolean).join(' — ') || 'Lokasi presensi';
    if (row.lat == null || row.lng == null) { setPeta({ judul, lat: null, lng: null, loading: false, err: 'Baris ini tidak punya koordinat.', alamat: '' }); return; }
    if (row.idMap) {
      setPeta({ judul, lat: row.lat, lng: row.lng, loading: false, err: '', alamat: row.alamatPresensi || '' });
      try { const k = await ambilLatlong(row.idMap); if (k.lat != null && k.lng != null) setPeta((p) => p ? { ...p, lat: k.lat!, lng: k.lng! } : p); }
      catch (e) { const err = e as ApiError; if (err.sesiHabis) { await tanganiSesiHabis(err.message); return; } }
    } else {
      setPeta({ judul, lat: row.lat, lng: row.lng, loading: false, err: '', alamat: row.alamatPresensi || '' });
    }
  }, [tanganiSesiHabis]);

  const lihatBerkas = useCallback(async (path: string) => {
    const nama = String(path).split('/').pop() || 'berkas';
    const proxyUrl = urlBerkas(path);
    const ext = nama.split('.').pop()?.toLowerCase() || '';
    const isImageExt = ['jpg','jpeg','png','gif','webp','bmp'].includes(ext);
    if (isImageExt && proxyUrl) { setBerkas({ nama, loading: false, err: '', url: proxyUrl, tipe: 'image/jpeg' }); return; }
    setBerkas({ nama, loading: true, err: '', url: null, tipe: '' });
    try { const { blob, contentType } = await ambilBerkas(path); setBerkas({ nama, loading: false, err: '', url: URL.createObjectURL(blob), tipe: contentType || blob.type || '' }); }
    catch (e) { const err = e as ApiError; if (err.sesiHabis) { await tanganiSesiHabis(err.message); return; } setBerkas({ nama, loading: false, err: err.message, url: null, tipe: '' }); }
  }, [tanganiSesiHabis]);

  const tutupBerkas = useCallback(() => { setBerkas((b) => { if (b?.url && b.url.startsWith('blob:')) URL.revokeObjectURL(b.url); return null; }); }, []);
  const barisPerizinanTampil = semuaPerizinan || (perizinan ? perizinan.baris : []);
  const berkasUnik = semuaPerizinan ? [...new Set(semuaPerizinan.map((r) => r.berkas).filter(Boolean))].length : 0;

  return (
    <div className="space-y-6">
      <form onSubmit={proses} className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-indigo-500" />
          <h2 className="font-semibold text-sm text-slate-800 dark:text-slate-200">Login {tampilDetail ? 'e-Presensi' : 'Web Presensi'}</h2>
        </div>

        {sudahLogin && (
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60 sm:flex-row sm:items-center">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-slate-500 dark:text-slate-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Berhasil login</p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900/60">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Nama</p>
                  <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{hasilImei?.profil?.nama || 'Pegawai'}</p>
                </div>
                <div className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900/60">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">NIP</p>
                  <p className="break-all text-sm font-medium text-slate-800 dark:text-slate-200">{hasilImei?.profil?.nip || nip.trim() || '—'}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {!sudahLogin && !memulihkanSesi && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5" htmlFor="web-nip">NIP</label>
                <input id="web-nip" value={nip} onChange={(e) => { nipDiubahManual.current = true; setNip(e.target.value.replace(/\s/g, '')); }} placeholder="NIP 18 digit" required autoComplete="off" className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 transition" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5" htmlFor="web-password">Password</label>
                <div className="relative">
                  <input id="web-password" value={password} onChange={(e) => { passwordDiubahManual.current = true; setPassword(e.target.value.replace(/\s/g, '')); }} type={lihatPassword ? 'text' : 'password'} placeholder="Password" required autoComplete="current-password" className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pl-4 pr-11 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 transition" />
                  <button type="button" onClick={() => setLihatPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors" tabIndex={-1} aria-label={lihatPassword ? 'Sembunyikan password' : 'Tampilkan password'}>{lihatPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end sm:gap-2">
              <div className="order-2 sm:order-1">
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5" htmlFor="web-captcha">Captcha</label>
                <input id="web-captcha" value={captcha} onChange={(e) => simpanCaptcha(e.target.value.replace(/\s/g, ''))} placeholder="Ketik kode captcha" autoComplete="off" inputMode="numeric" maxLength={6} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 transition" />
              </div>
              <div className="order-1 flex items-center gap-2 sm:order-2">
                <div className={`relative h-11 w-[191px] shrink-0 overflow-hidden rounded-none border ${captchaImg ? 'border-black bg-black' : 'border-dashed border-slate-300 bg-white dark:border-slate-600'}`} aria-busy={loadingCaptcha}>
                  {captchaImg && <img src={captchaImg} alt="Captcha" className="h-full w-full object-contain" />}
                  {loadingCaptcha && <div className="absolute inset-0 animate-pulse bg-slate-200/60 dark:bg-slate-700/50" aria-hidden="true" />}
                </div>
                <button type="button" onClick={() => void refreshCaptcha()} disabled={loadingCaptcha} className="h-11 w-11 shrink-0 grow rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 disabled:opacity-40 dark:hover:text-indigo-400 transition flex items-center justify-center sm:grow-0 sm:w-11" title="Muat ulang captcha" aria-label="Muat ulang captcha"><RefreshCw className={`w-4 h-4 ${loadingCaptcha ? 'animate-spin' : ''}`} /></button>
              </div>
            </div>
          </>
        )}

        {!sudahLogin && !memulihkanSesi && captchaInfo && <p className="text-[11px] text-slate-400 dark:text-slate-500 italic">{captchaInfo}</p>}
        {status && <div className="flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400">{memulihkanSesi && !loadingProses ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Loader2 className="w-4 h-4 animate-spin" />}{status}</div>}
        {error && <Pesan tipe="error">{error}</Pesan>}
        <div className="flex flex-wrap gap-3 pt-1">
          {!sudahLogin && (
            <button type="submit" disabled={loadingProses || loadingCaptcha || memulihkanSesi} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95">
              {loadingProses ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              {loadingProses ? 'Memproses...' : memulihkanSesi ? 'Memulihkan sesi...' : 'Login & Ambil Data'}
            </button>
          )}
          {sudahLogin && (
            <button type="button" onClick={() => void keluar()} disabled={loadingLogout} className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 px-5 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors">
              {loadingLogout ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
              {loadingLogout ? 'Keluar...' : 'Logout'}
            </button>
          )}
        </div>
      </form>

      {sudahLogin && (
        <div className="space-y-4">
          <div className="flex gap-1 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 shadow-sm">
            {DAFTAR_TAB.map((t) => {
              const Icon = t.icon;
              return (
                <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all sm:flex-none ${tab === t.id ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800'}`}>
                  <Icon className="w-4 h-4" /><span className="hidden sm:inline">{t.label}</span>
                </button>
              );
            })}
          </div>

          {tab === 'imei' && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-4">
              <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2"><Cpu className="w-5 h-5 text-indigo-500" />IMEI Device</h2>
              {hasilImei?.imei ? (
                <div className="flex items-center gap-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-5 py-4">
                  <code className="flex-1 font-mono text-base font-semibold text-indigo-600 dark:text-indigo-400 tracking-wider break-all">{hasilImei.imei}</code>
                  <button type="button" onClick={() => void salin(hasilImei.imei!)} aria-label="Salin IMEI" title="Salin IMEI" className={`shrink-0 flex items-center gap-1.5 rounded-lg !p-2 sm:!px-3 sm:!py-2 text-sm font-medium transition-all ${copied === hasilImei.imei ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600'}`}>{copied === hasilImei.imei ? <><Check className="w-4 h-4" /><span className="hidden sm:inline">Tersalin!</span></> : <><Copy className="w-4 h-4" /><span className="hidden sm:inline">Salin</span></>}</button>
                </div>
              ) : <Pesan tipe="info">Tidak ada IMEI pada halaman kehadiran.</Pesan>}
            </div>
          )}

          {tab === 'kehadiran' && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2"><Monitor className="w-5 h-5 text-indigo-500" />Riwayat Kehadiran</h2>
                <button type="button" onClick={() => void muatKehadiran(kehadiran?.halaman ?? 1)} disabled={kehadiranLoading} className="flex shrink-0 items-center gap-1.5 rounded-lg !p-2 sm:!px-3 sm:!py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors"><RefreshCw className={`w-3.5 h-3.5 ${kehadiranLoading ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">{kehadiranLoading ? 'Memuat...' : 'Muat ulang'}</span></button>
              </div>
              {kehadiranErr && <Pesan tipe="error">{kehadiranErr}</Pesan>}
              {kehadiranLoading && !kehadiran && <Tabel kolom={['Waktu', 'Jenis', 'IMEI', 'Jarak', 'Lokasi', 'Status', '']}>{[...Array(5)].map((_, i) => <SkeletonBaris key={i} cols={7} />)}</Tabel>}
              {kehadiran && kehadiran.baris.length > 0 && (
                <>
                  <Tabel kolom={['Waktu', 'Jenis', 'IMEI', 'Jarak', 'Lokasi Presensi', 'Status', '']}>
                    {kehadiran.baris.map((r, i) => (
                      <tr key={`${r.id || i}-${r.created_at}`} className="text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors align-top">
                        <td className="px-3 py-2.5 w-28"><CellWaktu nilai={r.created_at} /></td>
                        <td className="px-3 py-2.5 w-24"><div className="text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">{r.checktype}</div>{r.wfh && <span className="inline-flex mt-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap">{r.wfh}</span>}</td>
                        <td className="px-3 py-2.5 max-w-[140px]"><code className="text-[11px] text-slate-500 dark:text-slate-400 break-all leading-relaxed">{r.imei || '—'}</code></td>
                        <td className="px-3 py-2.5 text-xs whitespace-nowrap">{r.jarak || '—'}</td>
                        <td className="px-3 py-2.5 text-xs min-w-[180px] max-w-[260px]">{r.alamatPresensi ? <div className="text-slate-600 dark:text-slate-300 leading-relaxed">{r.alamatPresensi}</div> : <span className="text-slate-400">—</span>}{r.unitKerja && <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">{r.unitKerja}</div>}</td>
                        <td className="px-3 py-2.5 w-28"><Lencana nilai={r.disetujui} />{r.waktuApproval && <CellWaktu nilai={r.waktuApproval} />}</td>
                        <td className="px-3 py-2.5 w-14"><button type="button" onClick={() => void bukaPeta(r)} disabled={r.lat == null} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-30 disabled:cursor-not-allowed dark:text-indigo-400 dark:hover:bg-indigo-950/30 transition-colors"><Map className="w-3.5 h-3.5" /></button></td>
                      </tr>
                    ))}
                  </Tabel>
                  <Paginasi halaman={kehadiran.halaman} totalHalaman={kehadiran.totalHalaman} onPilih={muatKehadiran} disabled={kehadiranLoading} />
                </>
              )}
              {!kehadiranLoading && !kehadiranErr && kehadiran && kehadiran.baris.length === 0 && <Pesan tipe="info">Tidak ada baris kehadiran.</Pesan>}
            </div>
          )}

          {tab === 'detail' && tampilDetail && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2"><UserSquare2 className="w-5 h-5 text-indigo-500" />Detail Pegawai</h2>
                <button type="button" onClick={() => void muatDetail()} disabled={detailLoading} className="flex shrink-0 items-center gap-1.5 rounded-lg !p-2 sm:!px-3 sm:!py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors"><RefreshCw className={`w-3.5 h-3.5 ${detailLoading ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">{detailLoading ? 'Memuat...' : 'Muat ulang'}</span></button>
              </div>
              {detailErr && <Pesan tipe="error">{detailErr}</Pesan>}
              {detailLoading && !detail && <div className="animate-pulse space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-4 rounded bg-slate-200 dark:bg-slate-700" style={{ width: `${40+i*8}%` }} />)}</div>}
              {detail && (
                <>
                  <div className="flex gap-5">
                    {detail.foto && <img src={urlBerkas(detail.foto) || ''} alt="Foto pegawai" className="w-24 h-24 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 shrink-0" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />}
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                      {Object.entries(detail.profil || {}).map(([k, v]) => <div key={k} className="flex flex-col"><span className="text-[11px] text-slate-400 dark:text-slate-500">{k}</span><span className="text-sm text-slate-700 dark:text-slate-300 font-medium">{v}</span></div>)}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">Riwayat Login / Perangkat</h3>
                    {detail.logLogin && detail.logLogin.baris.length > 0 ? <Tabel kolom={detail.logLogin.header}>{detail.logLogin.baris.map((row, i) => <tr key={i} className="text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">{row.map((c, j) => <td key={j} className="px-3 py-2.5 text-xs">{c}</td>)}</tr>)}</Tabel> : <Pesan tipe="info">Tidak ada data login/perangkat.</Pesan>}
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">Daftar Ijin</h3>
                    {ijinAjaxErr && <Pesan tipe="error">{ijinAjaxErr}</Pesan>}
                    {ijinAjaxLoading && <div className="flex items-center gap-2 text-sm text-slate-500 py-2"><Loader2 className="w-4 h-4 animate-spin" />Memuat daftar ijin...</div>}
                    {ijinAjax && ijinAjax.length > 0 ? (
                      <Tabel kolom={['Tipe', 'Jenis', 'Tgl Ijin', 'Alasan', 'Status', '']}>
                        {ijinAjax.map((r, i) => (
                          <tr key={i} className="text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors align-top">
                            <td className="px-3 py-2.5 text-xs whitespace-nowrap">{r.tipeIjin}</td>
                            <td className="px-3 py-2.5 text-xs">{r.jenisIjin}</td>
                            <td className="px-3 py-2.5 text-xs whitespace-nowrap">{r.tglIjin}</td>
                            <td className="px-3 py-2.5 text-xs max-w-[200px]">{r.alasan || '—'}</td>
                            <td className="px-3 py-2.5"><Lencana nilai={r.disetujui} /></td>
                            <td className="px-3 py-2.5">{r.berkas ? <button type="button" onClick={() => void lihatBerkas(r.berkas!)} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/30 transition-colors"><Eye className="w-3.5 h-3.5" />Lihat</button> : <span className="text-slate-400 text-xs">—</span>}</td>
                          </tr>
                        ))}
                      </Tabel>
                    ) : (!ijinAjaxLoading && !ijinAjaxErr && <Pesan tipe="info">Tidak ada data ijin.</Pesan>)}
                  </div>
                </>
              )}
              {!detail && !detailLoading && !detailErr && <Pesan tipe="info">Memuat data detail pegawai...</Pesan>}
            </div>
          )}

          {tab === 'perizinan' && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2"><FileText className="w-5 h-5 text-indigo-500" />Perizinan / Cuti</h2>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => { setSemuaPerizinan(null); void muatPerizinan(perizinan?.halaman ?? 1); }} disabled={perizinanLoading || memuatSemua} className="flex shrink-0 items-center gap-1.5 rounded-lg !p-2 sm:!px-3 sm:!py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors border border-slate-200 dark:border-slate-700"><RefreshCw className={`w-3.5 h-3.5 ${perizinanLoading ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">{perizinanLoading ? 'Memuat...' : 'Muat ulang'}</span></button>
                  <button type="button" onClick={() => void muatSemuaPerizinan()} disabled={memuatSemua || perizinanLoading} className="flex shrink-0 items-center gap-1.5 rounded-lg !p-2 sm:!px-3 sm:!py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-40 dark:text-indigo-400 dark:hover:bg-indigo-950/30 transition-colors border border-indigo-200 dark:border-indigo-800/40">{memuatSemua ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}<span className="hidden sm:inline">{memuatSemua ? 'Memuat...' : 'Semua halaman'}</span></button>
                </div>
              </div>
              {perizinanErr && <Pesan tipe="error">{perizinanErr}</Pesan>}
              {memuatSemua && status && <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400"><Loader2 className="w-4 h-4 animate-spin" />{status}</div>}
              {semuaPerizinan && <div className="flex items-center justify-between rounded-xl bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-800/40 px-4 py-3 text-sm text-indigo-700 dark:text-indigo-300"><span><strong>{semuaPerizinan.length}</strong> baris{berkasUnik > 0 && <> · <strong>{berkasUnik}</strong> berkas unik</>}</span><button type="button" onClick={() => setSemuaPerizinan(null)} className="text-xs underline hover:no-underline">Per halaman</button></div>}
              {perizinanLoading && !perizinan && <Tabel kolom={['Tipe / Jenis', 'Tgl Izin', 'Alasan', 'Status', 'Dibuat', '']}>{[...Array(5)].map((_, i) => <SkeletonBaris key={i} cols={6} />)}</Tabel>}
              {barisPerizinanTampil.length > 0 && (
                <>
                  <Tabel kolom={['Tipe / Jenis', 'Tgl Izin', 'Alasan', 'Status', 'Dibuat', '']}>
                    {barisPerizinanTampil.map((r, i) => (
                      <tr key={`${r.id || i}-${r.createdAt}`} className="text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors align-top">
                        <td className="px-3 py-2.5 text-xs min-w-[100px]"><div className="font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">{r.tipeIjin}</div><div className="text-slate-400 dark:text-slate-500 mt-0.5 whitespace-nowrap">{r.jenisIjin}</div></td>
                        <td className="px-3 py-2.5 text-xs min-w-[90px] max-w-[130px]">{r.tglIjin ? (r.tglIjin.includes('s/d') || r.tglIjin.includes(' - ') ? (() => { const sep = r.tglIjin.includes('s/d') ? 's/d' : '-'; const [tgl1, tgl2] = r.tglIjin.split(new RegExp(`\\s*${sep}\\s*`)); return (<div><div className="whitespace-nowrap">{tgl1?.trim()}</div><div className="text-slate-400 dark:text-slate-500 whitespace-nowrap">s/d {tgl2?.trim()}</div></div>); })() : <div className="whitespace-nowrap">{r.tglIjin}</div>) : <span className="text-slate-400">—</span>}</td>
                        <td className="px-3 py-2.5 text-xs min-w-[140px] max-w-[240px]"><div className="leading-relaxed">{r.alasan || '—'}</div>{r.catatan && <div className="text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">Catatan: {r.catatan}</div>}</td>
                        <td className="px-3 py-2.5 min-w-[90px]"><Lencana nilai={r.disetujui} />{r.approvalAt && <CellWaktu nilai={r.approvalAt} />}</td>
                        <td className="px-3 py-2.5"><CellWaktu nilai={r.createdAt} /></td>
                        <td className="px-3 py-2.5 w-14">{r.berkas ? <button type="button" onClick={() => void lihatBerkas(r.berkas!)} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/30 transition-colors"><Eye className="w-3.5 h-3.5" /></button> : <span className="text-slate-400 text-xs">—</span>}</td>
                      </tr>
                    ))}
                  </Tabel>
                  {!semuaPerizinan && perizinan && <Paginasi halaman={perizinan.halaman} totalHalaman={perizinan.totalHalaman} onPilih={muatPerizinan} disabled={perizinanLoading} />}
                </>
              )}
              {!perizinanLoading && !perizinanErr && barisPerizinanTampil.length === 0 && <Pesan tipe="info">Tidak ada data perizinan.</Pesan>}
            </div>
          )}
        </div>
      )}

      {peta && (
        <Modal judul="Lokasi Presensi" kotak onTutup={() => setPeta(null)} mediaMod={peta.lat != null}>
          {peta.err && <div className="p-5"><Pesan tipe="error">{peta.err}</Pesan></div>}
          {peta.lat != null && peta.lng != null && (<><div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800"><p className="text-sm font-medium text-slate-700 dark:text-slate-200">{peta.judul}</p>{peta.alamat && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{peta.alamat}</p>}</div><Peta lat={peta.lat} lng={peta.lng} judul={peta.judul} /></>)}
          {peta.lat == null && !peta.err && <div className="p-5"><Pesan tipe="info">Tidak ada koordinat untuk ditampilkan.</Pesan></div>}
        </Modal>
      )}
      {berkas && <ViewerBerkas berkas={berkas} onTutup={tutupBerkas} />}
    </div>
  );
}
