import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowRight, Building2, CalendarClock, CheckCircle2, Fingerprint, MapPin, RefreshCw,
  Sparkles, XCircle, FileCheck, FileText, Activity, Briefcase,
  CreditCard, Clock, UserCheck, ChevronDown, ChevronUp, Copy, Check, Camera, Trash2, X,
  Smartphone, Send, AlertTriangle,
} from 'lucide-react';
import { usePonorogoAppContext as useAppContext } from '../context/AppContext';
import { ActionButton, Alert, Badge, Card, CardTitle, PageHeader, StatTile } from '../components/ui/Surface';
import { sendRequest } from '../api';
import { apiUrl } from '../lib/apiBase';
import { useResolvedImageSource } from '../hooks/useResolvedImageSource';
import { getTodayWIB } from '../lib/dateFormatter';
import { loadPegawaiDatabase } from '../lib/pegawaiData';
import ImageLightbox from '../components/ui/ImageLightbox';
import { useBackButton } from '../hooks/useBackButton';
import { updateServerLoginCacheFoto } from '../lib/cacheManager';

const sanitizeText = (text?: string): string => {
  if (!text) return '';
  return String(text).trim().replace(/^\*+|\*+$/g, '').trim();
};


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

function extractJam(dt: any): string | null {
  if (!dt) return null;
  const s = String(dt);
  const dtMatch = s.match(/\d{4}-\d{2}-\d{2}[T ](\d{2}:\d{2})/);
  if (dtMatch) return dtMatch[1];
  const tMatch = s.match(/^(\d{2}:\d{2})/);
  return tMatch ? tMatch[1] : null;
}

function getTargetEmployeeId(pegawai: any, config: any): string {
  const id = pegawai?.id_pegawai || pegawai?.id || config?.idPegawai || '';
  return id == null ? '' : String(id);
}

function FieldRow({ icon, label, value, extra }: { icon: React.ReactNode; label: string; value: string; extra?: string }) {
  return (
    <div className="bg-slate-50 dark:bg-slate-900/50 px-3 py-2 rounded-xl flex items-center gap-2.5 border border-slate-100 dark:border-slate-800/80">
      <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 text-slate-600 dark:text-slate-300">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] leading-tight text-slate-500 dark:text-slate-400 font-medium">{label}{extra ? ` ${extra}` : ''}</p>
        <p className="text-xs sm:text-[13px] font-semibold text-slate-900 dark:text-slate-200 leading-snug truncate">{value || 'Tidak tersedia'}</p>
      </div>
    </div>
  );
}

export default function BerandaPonorogo() {
  const { pegawai, setPegawai, config, setConfig, setActivePage, loginForm, userRole, tabPermissions, currentUser } = useAppContext() as any;
  const canEdit = !pegawai || userRole === 'admin' || (tabPermissions?.allowEditLoginCredentials ?? false);

  const [jamKerja, setJamKerja] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fullPegawaiInfo, setFullPegawaiInfo] = useState<any>(null);

  // Credentials / modals
  const [isKredensialOpen, setIsKredensialOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [isUpdateImeiOpen, setIsUpdateImeiOpen] = useState(false);
  const [imeiInput, setImeiInput] = useState('');
  const [imeiLoading, setImeiLoading] = useState(false);
  const [imeiOutput, setImeiOutput] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Photo viewer/crop
  const [modalImg, setModalImg] = useState<{ src: string, title: string } | null>(null);
  const [isProfilePhotoViewerOpen, setIsProfilePhotoViewerOpen] = useState(false);
  const [isCropperOpen, setIsCropperOpen] = useState(false);
  const [cropperImageSrc, setCropperImageSrc] = useState<string | null>(null);
  const [cropperImageObj, setCropperImageObj] = useState<HTMLImageElement | null>(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropOffsetX, setCropOffsetX] = useState(0);
  const [cropOffsetY, setCropOffsetY] = useState(0);
  const [isCropDragging, setIsCropDragging] = useState(false);
  const [cropDragStart, setCropDragStart] = useState({ x: 0, y: 0 });
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [photoActionMessage, setPhotoActionMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const cropperCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const today = getTodayWIB();

  useBackButton(() => {
    if (isUpdateImeiOpen) { setIsUpdateImeiOpen(false); return true; }
    if (isCropperOpen) { setIsCropperOpen(false); return true; }
    if (isProfilePhotoViewerOpen) { setIsProfilePhotoViewerOpen(false); return true; }
    setModalImg(null);
    return true;
  }, !!modalImg || isProfilePhotoViewerOpen || isCropperOpen || isUpdateImeiOpen);

  const loadDashboard = useCallback(async () => {
    const targetId = getTargetEmployeeId(pegawai, config);
    if (!targetId) { setJamKerja(null); return; }
    setLoading(true);
    setLoadError(null);
    try {
      const res: any = await sendRequest('/pegawai/getJamKerjaPegawai', { id_pegawai: targetId });
      let jamObj: any = null;
      if (Array.isArray(res)) jamObj = res[0] ?? null;
      else if (Array.isArray(res?.data)) jamObj = res.data[0] ?? null;
      else if (res?.data && typeof res.data === 'object') jamObj = res.data;
      else if (res?.jam_mulai_scan_masuk || res?.jam_kerja || res?.id_pegawai) jamObj = res;
      else if (res && Object.keys(res).length > 2) jamObj = res;
      setJamKerja(jamObj);
    } catch (err: any) {
      setLoadError(err?.message || 'Gagal memuat data beranda.');
      setJamKerja(null);
    } finally {
      setLoading(false);
    }
  }, [pegawai, config]);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  useEffect(() => {
    const targetId = config?.idPegawai || pegawai?.id || (pegawai as any)?.id_pegawai;
    if (!targetId) { setFullPegawaiInfo(null); return; }
    let cancelled = false;
    loadPegawaiDatabase().then((dataPegawai) => {
      if (cancelled) return;
      const list = Array.isArray(dataPegawai) ? dataPegawai : [];
      const found = list.find((p: any) => String(p.id) === String(targetId) || (pegawai?.nip && String(p.nip) === String(pegawai.nip))) || null;
      setFullPegawaiInfo(found);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [pegawai, config?.idPegawai]);

  const hasAbsenMasuk = !!(jamKerja?.absen_masuk && String(jamKerja.absen_masuk) !== '' && String(jamKerja.absen_masuk) !== 'null');
  const hasAbsenPulang = !!(jamKerja?.absen_pulang && String(jamKerja.absen_pulang) !== '' && String(jamKerja.absen_pulang) !== 'null');
  const jamMasukAktif = hasAbsenMasuk ? extractJam(jamKerja?.absen_masuk) : null;
  const jamPulangAktif = hasAbsenPulang ? extractJam(jamKerja?.absen_pulang) : null;
  const lokasiLabel = String((pegawai as any)?.nama_lokasi || (pegawai as any)?.nama_instansi || (pegawai as any)?.instansi || (config?.idLokasi ? 'Lokasi terdaftar' : ''));
  const lokasiTerdaftar = !!(config?.idLokasi || (pegawai as any)?.id_lokasi || lokasiLabel);
  const namaDepan = useMemo(() => String(pegawai?.nama || loginForm?.username || 'Pegawai').split(' ')[0], [pegawai?.nama, loginForm?.username]);

  const fotoRaw = pegawai?.foto ? String(pegawai.foto) : '';
  const fotoUrl = fotoRaw
    ? (fotoRaw.startsWith('data:') ? fotoRaw : apiUrl(`/api/proxy-image?path=${encodeURIComponent(fotoRaw)}`))
    : 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
  const resolvedFotoUrl = useResolvedImageSource(fotoUrl);

  const handleCopyId = (idToCopy: string) => {
    if (!idToCopy || idToCopy === '-') return;
    navigator.clipboard.writeText(idToCopy).catch(() => {});
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleUpdateImei = async () => {
    if (!imeiInput.trim()) { setImeiOutput({ type: 'error', text: 'Device ID / IMEI tidak boleh kosong.' }); return; }
    setImeiLoading(true); setImeiOutput(null);
    try {
      const data = await sendRequest('/login/update_imei', { username: loginForm?.username || pegawai?.nip, password: pegawai?.password || '', imei: imeiInput.trim() });
      if (data && (data.success || data.status === 'success' || data.code === 200 || data.code === '200')) {
        setImeiOutput({ type: 'success', text: data.message || 'Device ID berhasil diperbarui.' });
        setConfig?.((prev: any) => ({ ...prev, deviceId: imeiInput.trim() }));
        setTimeout(() => { setIsUpdateImeiOpen(false); setImeiOutput(null); }, 1500);
      } else {
        setImeiOutput({ type: 'error', text: data?.message || data?.error || 'Update gagal. Coba lagi.' });
      }
    } catch (err: any) {
      setImeiOutput({ type: 'error', text: `Network Error: ${err.message}` });
    } finally { setImeiLoading(false); }
  };

  // Cropper draw
  useEffect(() => {
    if (!isCropperOpen || !cropperImageSrc || !cropperImageObj || !cropperCanvasRef.current) return;
    const canvas = cropperCanvasRef.current;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const cw = canvas.width, ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch); ctx.save();
    const imgW = cropperImageObj.width, imgH = cropperImageObj.height;
    const ratio = Math.min(cw / imgW, ch / imgH);
    const w = imgW * ratio * cropZoom, h = imgH * ratio * cropZoom;
    const cx = cw / 2, cy = ch / 2;
    ctx.drawImage(cropperImageObj, cx - w / 2 + cropOffsetX, cy - h / 2 + cropOffsetY, w, h);
    ctx.fillStyle = 'rgba(15,23,42,0.75)'; ctx.beginPath(); ctx.rect(0,0,cw,ch);
    const cropRadius = 110; ctx.arc(cx, cy, cropRadius, 0, Math.PI * 2, true); ctx.fill();
    ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2.5; ctx.setLineDash([6,4]);
    ctx.beginPath(); ctx.arc(cx, cy, cropRadius, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }, [isCropperOpen, cropperImageSrc, cropperImageObj, cropZoom, cropOffsetX, cropOffsetY]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const src = event.target?.result as string; setCropperImageSrc(src);
      const img = new Image();
      img.onload = () => { setCropperImageObj(img); setCropZoom(1); setCropOffsetX(0); setCropOffsetY(0); setIsCropperOpen(true); setPhotoActionMessage(null); };
      img.src = src;
    };
    reader.readAsDataURL(file); e.target.value = '';
  };
  const handleDragStart = (e: any) => { const clientX = e.touches ? e.touches[0].clientX : e.clientX; const clientY = e.touches ? e.touches[0].clientY : e.clientY; setIsCropDragging(true); setCropDragStart({ x: clientX - cropOffsetX, y: clientY - cropOffsetY }); };
  const handleDragMove = (e: any) => { if (!isCropDragging) return; const clientX = e.touches ? e.touches[0].clientX : e.clientX; const clientY = e.touches ? e.touches[0].clientY : e.clientY; setCropOffsetX(clientX - cropDragStart.x); setCropOffsetY(clientY - cropDragStart.y); };
  const handleDragEnd = () => setIsCropDragging(false);

  const handleCropAndSave = async () => {
    if (!cropperImageObj || !cropperCanvasRef.current) return;
    setIsUploadingPhoto(true); setPhotoActionMessage(null);
    try {
      const cw = 300, ch = 300, cropRadius = 110;
      const finalCanvas = document.createElement('canvas'); finalCanvas.width = 400; finalCanvas.height = 400;
      const finalCtx = finalCanvas.getContext('2d'); if (!finalCtx) throw new Error('Gagal membuat konteks gambar');
      const imgW = cropperImageObj.width, imgH = cropperImageObj.height;
      const ratio = Math.min(cw / imgW, ch / imgH);
      const w = imgW * ratio * cropZoom, h = imgH * ratio * cropZoom;
      const scaleFactor = finalCanvas.width / (cropRadius * 2);
      const cropCx = finalCanvas.width / 2, cropCy = finalCanvas.height / 2;
      finalCtx.drawImage(cropperImageObj, cropCx - (w*scaleFactor)/2 + cropOffsetX*scaleFactor, cropCy - (h*scaleFactor)/2 + cropOffsetY*scaleFactor, w*scaleFactor, h*scaleFactor);
      const croppedBase64 = finalCanvas.toDataURL('image/jpeg', 0.85);
      const rawBase64 = croppedBase64.split(',')[1];
      const response = await sendRequest('/login/do_Simpan_Ubah_Foto', { id_pegawai: config?.idPegawai || pegawai?.id || (pegawai as any)?.id_pegawai, foto: rawBase64 });
      if (response?.success) {
        const newFoto = response.foto || response.path || croppedBase64;
        setPegawai?.((prev: any) => prev ? ({ ...prev, foto: newFoto }) : prev);
        const ponorogoUsername = currentUser?.username ?? 'default_admin';
        try { updateServerLoginCacheFoto(ponorogoUsername, newFoto); } catch {}
        setPhotoActionMessage({ type: 'success', text: 'Foto profil berhasil disimpan.' });
        setTimeout(() => { setIsCropperOpen(false); setCropperImageSrc(null); setCropperImageObj(null); setIsProfilePhotoViewerOpen(false); }, 1200);
      } else {
        setPhotoActionMessage({ type: 'error', text: response?.message || 'Gagal menyimpan foto profil.' });
      }
    } catch (err: any) {
      setPhotoActionMessage({ type: 'error', text: err?.message || 'Terjadi kesalahan sistem.' });
    } finally { setIsUploadingPhoto(false); }
  };

  const handleDeletePhoto = async () => {
    if (!window.confirm('Apakah Anda yakin ingin menghapus foto profil?')) return;
    setIsUploadingPhoto(true); setPhotoActionMessage(null);
    try {
      const response = await sendRequest('/login/do_Simpan_Ubah_Foto', { id_pegawai: config?.idPegawai || pegawai?.id || (pegawai as any)?.id_pegawai, foto: 'null' });
      if (response?.success) {
        setPegawai?.((prev: any) => prev ? ({ ...prev, foto: '' }) : prev);
        const ponorogoUsername = currentUser?.username ?? 'default_admin';
        try { updateServerLoginCacheFoto(ponorogoUsername, ''); } catch {}
        setPhotoActionMessage({ type: 'success', text: 'Foto profil berhasil dihapus.' });
        setTimeout(() => setIsProfilePhotoViewerOpen(false), 1200);
      } else {
        setPhotoActionMessage({ type: 'error', text: response?.message || 'Gagal menghapus foto profil.' });
      }
    } catch (err: any) {
      setPhotoActionMessage({ type: 'error', text: err?.message || 'Terjadi kesalahan sistem.' });
    } finally { setIsUploadingPhoto(false); }
  };

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          title={`Halo, ${namaDepan}`}
          subtitle={`Ponorogo · ${pegawai?.nama_instansi || pegawai?.nama_lokasi || pegawai?.unor || pegawai?.nama_unit_kerja || 'Presensi Ponorogo'}`}
          icon={<Sparkles className="w-5 h-5" />}
          action={
            <ActionButton variant="secondary" size="sm" loading={loading} onClick={() => void loadDashboard()} icon={<RefreshCw className="w-4 h-4" />} aria-label="Muat ulang beranda" title="Muat ulang" className="!p-2 sm:!px-3 sm:!py-1.5">
              <span className="hidden sm:inline">Muat Ulang</span>
            </ActionButton>
          }
        />

        {loadError && <Alert tone="rose">{loadError}</Alert>}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Status Hari Ini" value={jamMasukAktif ? 'Hadir' : 'Belum Absen'} hint={jamMasukAktif ? `Masuk ${jamMasukAktif}` : 'Belum ada catatan'} tone={jamMasukAktif ? 'emerald' : 'amber'} icon={jamMasukAktif ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />} />
          <StatTile label="Jam Masuk" value={jamMasukAktif ?? '--:--'} hint="Absen Datang hari ini" tone="blue" icon={<CalendarClock className="w-4 h-4" />} />
          <StatTile label="Jam Pulang" value={jamPulangAktif ?? '--:--'} hint="Absen Pulang hari ini" tone="violet" icon={<CalendarClock className="w-4 h-4" />} />
          <StatTile label="Lokasi Absen" value={lokasiTerdaftar ? 'Terdaftar' : 'Belum'} hint={lokasiLabel || (lokasiTerdaftar ? 'Lokasi tersedia' : 'Belum terdaftar')} tone={lokasiTerdaftar ? 'emerald' : 'slate'} icon={<MapPin className="w-4 h-4" />} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Identitas / Profil Pegawai (lengkap) */}
          <Card>
            <CardTitle>Identitas Presensi</CardTitle>
            {!pegawai ? (
              <div className="min-h-[120px] flex items-center justify-center bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
                <p className="text-slate-500 dark:text-slate-400 text-sm font-medium text-center">Silakan login untuk memuat profil.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="relative shrink-0">
                    <img
                      src={resolvedFotoUrl}
                      alt="Foto Profil"
                      onClick={() => setIsProfilePhotoViewerOpen(true)}
                      className={`w-16 h-16 sm:w-20 sm:h-20 rounded-full border-2 border-white dark:border-slate-800 object-cover shadow-sm ${canEdit ? 'cursor-pointer hover:opacity-90' : 'cursor-default'}`}
                      title={canEdit ? 'Klik untuk melihat & ubah foto' : 'Foto profil'}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight leading-snug truncate">{sanitizeText(pegawai.nama) || 'Data tidak tersedia'}</h4>
                    <div className="mt-1 inline-flex items-center max-w-full">
                      <span className="text-[11px] sm:text-xs font-mono font-medium text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-900/50 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 truncate">NIP. {sanitizeText(pegawai.nip) || 'Belum diatur'}</span>
                    </div>
                  </div>
                </div>

                <div className="grid gap-2">
                  <FieldRow icon={<Briefcase className="w-4 h-4 text-blue-600 dark:text-blue-400" />} label="Jabatan" extra={pegawai.kelas_jabatan ? `(Kelas ${sanitizeText(String(pegawai.kelas_jabatan))})` : ''} value={sanitizeText(pegawai.nama_jabatan)} />
                  <FieldRow icon={<Building2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />} label="OPD" value={sanitizeText(pegawai.nama_instansi)} />
                  <FieldRow
                    icon={<Building2 className="w-4 h-4 text-purple-600 dark:text-purple-400" />}
                    label="Unit Kerja"
                    value={sanitizeText(
                      pegawai?.unor ||
                      (pegawai as any)?.nama_unit_kerja ||
                      fullPegawaiInfo?.unor ||
                      fullPegawaiInfo?.nama_unit_kerja ||
                      ''
                    )}
                  />
                  <FieldRow icon={<MapPin className="w-4 h-4 text-rose-600 dark:text-rose-400" />} label="Alamat Kantor" value={sanitizeText(pegawai.alamat || pegawai.alamat_kantor)} />
                  <FieldRow icon={<CreditCard className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />} label="No. Rekening Bank Jatim" value={String(fullPegawaiInfo?.norekening || (pegawai as any)?.norekening || '')} />
                  <FieldRow icon={<UserCheck className="w-4 h-4 text-amber-600 dark:text-amber-400" />} label="Status Pegawai" value={String(fullPegawaiInfo?.status_pegawai || (pegawai as any)?.status_pegawai || '')} />
                  <FieldRow icon={<Clock className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />} label="Jam Kerja" value={String(fullPegawaiInfo?.jam_kerja || (pegawai as any)?.jam_kerja || jamKerja?.jam_kerja || '')} />
                </div>

                <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                  <button type="button" onClick={() => setIsKredensialOpen(v => !v)} className="w-full flex justify-between items-center text-left px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-800/60 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors border border-slate-200/50 dark:border-slate-700/50 cursor-pointer shadow-sm">
                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Informasi Kredensial</span>
                    {isKredensialOpen ? <ChevronUp className="w-4 h-4 opacity-70 shrink-0" /> : <ChevronDown className="w-4 h-4 opacity-70 shrink-0" />}
                  </button>

                  <AnimatePresence initial={false}>
                    {isKredensialOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: 'easeInOut' }} className="overflow-hidden">
                        <div className="grid grid-cols-2 gap-3 text-xs sm:text-sm pt-4">
                          <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800/80 col-span-2">
                            <span className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">ID Pegawai:</span>
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono font-semibold text-slate-900 dark:text-slate-200 break-all">{String(config?.idPegawai || pegawai?.id || (pegawai as any)?.id_pegawai || 'Tidak tersedia')}</span>
                              {(config?.idPegawai || pegawai?.id || (pegawai as any)?.id_pegawai) && (
                                <button onClick={() => handleCopyId(String(config?.idPegawai || pegawai?.id || (pegawai as any)?.id_pegawai))} className="p-1.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors shrink-0" title="Salin ID Pegawai">
                                  {copiedId ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800/80 col-span-2">
                            <span className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">IMEI / Device ID:</span>
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono font-semibold text-slate-900 dark:text-slate-200 break-all">{String(config?.deviceId || (pegawai as any)?.emai || (pegawai as any)?.imei || (pegawai as any)?.device_id || (pegawai as any)?.sim_serial || 'Tidak tersedia')}</span>
                              <button type="button" onClick={() => { setImeiInput(String(config?.deviceId || (pegawai as any)?.emai || (pegawai as any)?.imei || (pegawai as any)?.device_id || '')); setImeiOutput(null); setIsUpdateImeiOpen(true); }} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-800/50 hover:bg-amber-50 dark:hover:bg-amber-900/20 text-amber-600 dark:text-amber-400 text-[10px] font-bold transition-colors shrink-0 whitespace-nowrap" title="Update Device ID">
                                <Smartphone className="w-3.5 h-3.5" /> Update
                              </button>
                            </div>
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800/80">
                            <span className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">Latitude:</span>
                            <span className="font-mono font-semibold text-slate-900 dark:text-slate-200 break-all">{String(config?.latitude || (pegawai as any)?.lat || (pegawai as any)?.latitude || 'Tidak tersedia')}</span>
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800/80">
                            <span className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">Longitude:</span>
                            <span className="font-mono font-semibold text-slate-900 dark:text-slate-200 break-all">{String(config?.longitude || (pegawai as any)?.long || (pegawai as any)?.longitude || (pegawai as any)?.longtitude || 'Tidak tersedia')}</span>
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800/80 col-span-2 sm:col-span-1">
                            <span className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">ID Lokasi:</span>
                            <span className="font-mono font-semibold text-slate-900 dark:text-slate-200 break-all">{String(config?.idLokasi || (pegawai as any)?.id_lokasi || 'Tidak tersedia')}</span>
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800/80 col-span-2 sm:col-span-1">
                            <span className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">Kode Instansi:</span>
                            <span className="font-mono font-semibold text-slate-900 dark:text-slate-200 break-all">{String(config?.kodeInstansi || (pegawai as any)?.kode_instansi || 'Tidak tersedia')}</span>
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800/80 col-span-2">
                            <span className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">Kode Unit:</span>
                            <span className="font-mono font-semibold text-slate-900 dark:text-slate-200 break-all">{String(config?.kodeUnor || (pegawai as any)?.kode_unor || 'Tidak tersedia')}</span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </Card>

          {/* Aksi Cepat */}
          <Card>
            <CardTitle>Aksi Cepat</CardTitle>
            <div className="space-y-2.5">
              <QuickAction icon={<Fingerprint className="w-5 h-5" />} title="Submit Presensi" hint="Catat kehadiran hari ini" onClick={() => setActivePage('tabAbsen')} />
              <QuickAction icon={<FileCheck className="w-5 h-5" />} title="Izin / Cuti" hint="Ajukan dan lihat izin" onClick={() => setActivePage('tabIzin')} />
              <QuickAction icon={<FileText className="w-5 h-5" />} title="Laporan" hint="Rekap presensi & aktivitas" onClick={() => setActivePage('tabReport')} />
              <QuickAction icon={<Activity className="w-5 h-5" />} title="History Presensi" hint="Riwayat presensi Anda" onClick={() => setActivePage('tabLog')} />
            </div>

            <div className="mt-5 rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 bg-slate-50/60 dark:bg-slate-800/30 space-y-2 text-xs">
              <div className="flex justify-between gap-3"><span className="text-slate-500">Server</span><span className="font-semibold text-right text-slate-700 dark:text-slate-200">Ponorogo — Presensi Ponorogo</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">Tanggal</span><span className="font-mono text-[11px] text-right text-slate-600 dark:text-slate-300">{today}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">Status</span><Badge tone={pegawai ? 'emerald' : 'amber'}>{pegawai ? 'Terhubung' : 'Belum terhubung'}</Badge></div>
            </div>
          </Card>
        </div>
      </div>

      {modalImg && <ImageLightbox src={modalImg.src} title={modalImg.title} onClose={() => setModalImg(null)} />}

      {/* Profile Photo Viewer Modal */}
      <AnimatePresence>
        {isProfilePhotoViewerOpen && (
          <div className="modal-layer fixed inset-0 z-[150] flex items-center justify-center p-4" style={{ paddingTop: "max(1rem, var(--sat, env(safe-area-inset-top, 0px)))", paddingBottom: "max(1rem, var(--sab, env(safe-area-inset-bottom, 0px)))" }}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsProfilePhotoViewerOpen(false)} className="absolute inset-0 bg-slate-950/80" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 15 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 15 }} transition={{ type: 'spring', duration: 0.3 }} className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-800/80 overflow-hidden flex flex-col items-center text-center z-10">
              <div className="w-full flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-5">
                <span className="font-bold text-slate-800 dark:text-white text-sm">Foto Profil</span>
                <button onClick={() => setIsProfilePhotoViewerOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors"><X className="w-4.5 h-4.5" /></button>
              </div>
              <div className="relative w-52 h-52 sm:w-56 sm:h-56 rounded-full border-4 border-slate-100 dark:border-slate-800 object-cover overflow-hidden shadow-xl mb-6 group">
                <img src={resolvedFotoUrl} alt="Foto Profil Besar" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" referrerPolicy="no-referrer" />
              </div>
              <div className="w-full space-y-3">
                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
                {canEdit ? (
                  <>
                    <button onClick={() => fileInputRef.current?.click()} disabled={isUploadingPhoto} className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 text-sm"><Camera className="w-4 h-4" />Ubah Foto Profil</button>
                    {fotoRaw && <button onClick={handleDeletePhoto} disabled={isUploadingPhoto} className="w-full bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/20 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-bold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2 text-sm border border-rose-200/50 dark:border-rose-900/40"><Trash2 className="w-4 h-4" />Hapus Foto Profil</button>}
                  </>
                ) : (
                  <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200/50 dark:border-slate-700/50">
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Foto profil tidak dapat diubah.</p>
                  </div>
                )}
              </div>
              {photoActionMessage && (
                <div className={`w-full mt-4 p-3.5 rounded-xl text-xs font-semibold shadow-sm border ${photoActionMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30' : 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/30'}`}>{photoActionMessage.text}</div>
              )}
              {isUploadingPhoto && (
                <div className="absolute inset-0 bg-slate-950/40 flex items-center justify-center z-20">
                  <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-xl flex items-center gap-3"><div className="w-5 h-5 border-2 border-blue-600/30 border-t-blue-600 rounded-full animate-spin" /><span className="text-xs font-bold text-slate-700 dark:text-slate-200">Memproses...</span></div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Image Cropper Modal */}
      <AnimatePresence>
        {isCropperOpen && (
          <div className="modal-layer fixed inset-0 z-[160] flex items-center justify-center p-4" style={{ paddingTop: "max(1rem, var(--sat, env(safe-area-inset-top, 0px)))", paddingBottom: "max(1rem, var(--sab, env(safe-area-inset-bottom, 0px)))" }}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-950/85" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 15 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 15 }} className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-800 z-10 flex flex-col items-center">
              <div className="w-full flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3 mb-5">
                <span className="font-bold text-slate-800 dark:text-white text-sm">Sesuaikan Foto</span>
                <button onClick={() => setIsCropperOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"><X className="w-4.5 h-4.5" /></button>
              </div>
              <div className="relative overflow-hidden bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-700 w-[300px] h-[300px] mb-4 shadow-inner flex items-center justify-center">
                <canvas ref={cropperCanvasRef} width={300} height={300} onMouseDown={handleDragStart} onMouseMove={handleDragMove} onMouseUp={handleDragEnd} onMouseLeave={handleDragEnd} onTouchStart={handleDragStart} onTouchMove={handleDragMove} onTouchEnd={handleDragEnd} className="cursor-move touch-none" />
              </div>
              <div className="w-full px-2 mb-5">
                <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400 mb-2 font-semibold"><span>Zoom</span><span className="font-mono">{Math.round(cropZoom * 100)}%</span></div>
                <input type="range" min="1" max="3" step="0.05" value={cropZoom} onChange={e => setCropZoom(parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-100 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600" />
              </div>
              <div className="w-full grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setIsCropperOpen(false)} className="w-full py-3 px-4 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-sm transition-colors">Batal</button>
                <button type="button" onClick={handleCropAndSave} disabled={isUploadingPhoto} className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2">{isUploadingPhoto ? (<><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Memproses...</>) : 'Pangkas & Simpan'}</button>
              </div>
              {photoActionMessage && photoActionMessage.type === 'error' && <div className="w-full mt-4 p-3.5 bg-red-50 text-red-800 border border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/30 rounded-xl text-xs font-semibold shadow-sm">{photoActionMessage.text}</div>}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Update IMEI / Device ID */}
      <AnimatePresence>
        {isUpdateImeiOpen && (
          <div className="modal-layer fixed inset-0 z-[200] flex items-center justify-center p-4 overflow-y-auto" style={{ paddingTop: "max(1rem, var(--sat, env(safe-area-inset-top, 0px)))", paddingBottom: "max(1rem, var(--sab, env(safe-area-inset-bottom, 0px)))" }}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} onClick={() => !imeiLoading && setIsUpdateImeiOpen(false)} className="absolute inset-0 bg-slate-950/70" />
            <motion.div initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 8 }} transition={{ duration: 0.18, ease: 'easeOut' }} className="relative w-full max-w-md my-auto bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 z-10 max-h-[min(90vh,560px)] flex flex-col overflow-hidden" role="dialog" aria-modal="true">
              <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0"><Smartphone className="w-4 h-4 text-amber-600 dark:text-amber-400" /></div>
                  <div className="min-w-0"><span className="font-bold text-slate-800 dark:text-white text-sm block truncate">Update Device ID</span><span className="text-[10px] text-slate-400 dark:text-slate-500">IMEI / ID perangkat</span></div>
                </div>
                <button type="button" onClick={() => !imeiLoading && setIsUpdateImeiOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"><X className="w-4 h-4" /></button>
              </div>
              <div className="px-5 py-4 overflow-y-auto custom-scrollbar flex-1 space-y-4">
                <div className="flex items-start gap-2.5 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">Masukkan Device ID baru jika perangkat tidak dikenali.</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5 uppercase tracking-wide">Device ID / IMEI Baru <span className="text-red-500">*</span></label>
                  <input type="text" value={imeiInput} onChange={e => setImeiInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && void handleUpdateImei()} placeholder="Masukkan Device ID atau IMEI..." className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl px-4 py-3 text-sm font-mono text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 transition-colors" />
                </div>
                {imeiOutput && (
                  <div className={`p-3 rounded-xl text-xs font-semibold flex items-start gap-2 ${imeiOutput.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800/40'}`}>
                    {imeiOutput.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
                    <span className="leading-relaxed">{imeiOutput.text}</span>
                  </div>
                )}
              </div>
              <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-3 shrink-0 bg-slate-50/80 dark:bg-slate-900/80">
                <button type="button" onClick={() => setIsUpdateImeiOpen(false)} disabled={imeiLoading} className="py-2.5 px-4 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-sm transition-colors disabled:opacity-50">Batal</button>
                <button type="button" onClick={() => void handleUpdateImei()} disabled={imeiLoading || !imeiInput.trim()} className="py-2.5 px-4 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2">{imeiLoading ? (<><Smartphone className="w-4 h-4 animate-pulse" />Mengupdate...</>) : (<><Send className="w-4 h-4" />Update</>)}</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </>
  );
}
