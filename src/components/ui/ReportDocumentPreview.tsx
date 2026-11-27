import { useEffect, useRef, useState } from 'react';
import { Download, FileText, ExternalLink, Loader2 } from 'lucide-react';
import { isTauriRuntime } from '../../lib/nativeAutomation';
import { saveBlobSmart, saveBlobToCacheAndOpen } from '../../lib/nativeSave';
import { isAndroidTetuko, openReportOnAndroid } from '../../lib/androidNative';

interface ReportDocumentPreviewProps {
  file: Blob;
  format: 'pdf' | 'xls';
}

function isAndroidTauri(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (isTauriRuntime() || isAndroidTetuko()) && /android/i.test(navigator.userAgent);
}

function resolveMime(blob: Blob, format: 'pdf' | 'xls'): string {
  if (blob.type) return blob.type;
  return format === 'pdf' ? 'application/pdf' : 'application/vnd.ms-excel';
}

function resolveExtension(blob: Blob, format: 'pdf' | 'xls'): string {
  const mime = resolveMime(blob, format).toLowerCase();
  if (mime.includes('csv')) return 'csv';
  if (format === 'pdf') return 'pdf';
  if (mime.includes('spreadsheet') || mime.includes('openxml')) return 'xlsx';
  return 'xls';
}

export default function ReportDocumentPreview({ file, format }: ReportDocumentPreviewProps) {
  const [url, setUrl] = useState<string>('');
  const [opening, setOpening] = useState(false);
  const [openErr, setOpenErr] = useState('');
  const autoOpenedRef = useRef<string>('');
  const android = isAndroidTauri();

  const mime = file ? resolveMime(file, format) : '';
  const filename = file ? `laporan.${resolveExtension(file, format)}` : `laporan.${format}`;
  const fileKey = file ? `${filename}:${file.size}:${mime}` : '';

  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    setOpenErr('');
    return () => { URL.revokeObjectURL(u); };
  }, [file]);

  const openExternal = async (auto = false) => {
    if (!file) return;
    setOpening(true);
    setOpenErr('');
    try {
      if (android) {
        const ok = await openReportOnAndroid(file, filename, mime);
        if (!ok) throw new Error('Pembuka berkas Android tidak tersedia.');
        return;
      }
      if (isTauriRuntime()) {
        await saveBlobToCacheAndOpen(file, filename, mime);
      } else if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (e: any) {
      if (!auto) setOpenErr(e?.message || 'Gagal membuka laporan.');
    } finally {
      setOpening(false);
    }
  };

  // Android: laporan langsung dialihkan ke aplikasi eksternal (Chrome/PDF viewer/Excel).
  useEffect(() => {
    if (!android || !fileKey) return;
    if (autoOpenedRef.current === fileKey) return;
    autoOpenedRef.current = fileKey;
    void openExternal(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [android, fileKey]);

  const saveFile = async () => {
    if (!file) return;
    try {
      await saveBlobSmart({ blob: file, filename, mimeHint: mime });
    } catch (e: any) {
      setOpenErr(e?.message || 'Gagal menyimpan laporan.');
    }
  };

  if (!file) {
    return <div className="p-6 text-sm text-slate-500">Tidak ada dokumen untuk ditampilkan.</div>;
  }

  const actions = (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <button
        type="button"
        onClick={() => void openExternal(false)}
        disabled={opening}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2.5"
      >
        {opening ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />} Buka
      </button>
      <button
        type="button"
        onClick={() => void saveFile()}
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm font-semibold px-4 py-2.5"
      >
        <Download className="w-4 h-4" /> Simpan
      </button>
    </div>
  );

  if (format === 'pdf') {
    if (!android && url) {
      return (
        <div className="w-full flex-1 min-h-0 flex flex-col bg-slate-100 dark:bg-slate-950">
          <object data={url} type="application/pdf" className="w-full flex-1 min-h-[60vh] bg-white">
            <iframe title="Pratinjau Laporan PDF" src={url} className="w-full flex-1 min-h-[60vh] border-0 bg-white" />
          </object>
          <div className="shrink-0 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 flex flex-wrap items-center justify-center gap-2">
            {actions}
          </div>
        </div>
      );
    }

    return (
      <div className="w-full flex-1 min-h-0 flex items-center justify-center bg-slate-100 dark:bg-slate-950 p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center space-y-3 shadow-sm">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 flex items-center justify-center">
            <FileText className="w-6 h-6" />
          </div>
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Laporan PDF</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Laporan dibuka otomatis di aplikasi eksternal (Chrome/PDF viewer). Jika belum terbuka, gunakan tombol di bawah.
          </div>
          {openErr && <div className="text-xs text-red-600 dark:text-red-400">{openErr}</div>}
          <div className="pt-1">{actions}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full flex-1 min-h-0 flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center space-y-3 shadow-sm">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
          <FileText className="w-6 h-6" />
        </div>
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Laporan {format.toUpperCase()}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          {android
            ? 'Laporan dibuka otomatis di aplikasi eksternal (Chrome/Excel). Jika belum terbuka, gunakan tombol di bawah.'
            : 'Gunakan tombol di bawah untuk membuka atau menyimpan laporan.'}
        </div>
        {openErr && <div className="text-xs text-red-600 dark:text-red-400">{openErr}</div>}
        <div className="pt-1">{actions}</div>
      </div>
    </div>
  );
}
