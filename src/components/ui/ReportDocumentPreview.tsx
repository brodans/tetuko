import { useEffect, useState } from 'react';
import { Download, FileText, ExternalLink } from 'lucide-react';
import { isTauriRuntime } from '../../lib/nativeAutomation';

interface ReportDocumentPreviewProps {
  file: Blob;
  format: 'pdf' | 'xls';
}

function isAndroidTauri(): boolean {
  if (typeof navigator === 'undefined') return false;
  return isTauriRuntime() && /android/i.test(navigator.userAgent);
}

export default function ReportDocumentPreview({ file, format }: ReportDocumentPreviewProps) {
  const [url, setUrl] = useState<string>('');
  const [dataUrl, setDataUrl] = useState<string>('');
  const android = isAndroidTauri();

  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => {
      URL.revokeObjectURL(u);
    };
  }, [file]);

  useEffect(() => {
    if (!file || format !== 'pdf' || !android) {
      setDataUrl('');
      return;
    }
    let cancelled = false;
    const reader = new FileReader();
    reader.onload = () => { if (!cancelled) setDataUrl(String(reader.result || '')); };
    reader.onerror = () => { if (!cancelled) setDataUrl(''); };
    reader.readAsDataURL(file);
    return () => { cancelled = true; };
  }, [file, format, android]);

  if (!file) {
    return <div className="p-6 text-sm text-slate-500">Tidak ada dokumen untuk ditampilkan.</div>;
  }

  if (format === 'pdf') {
    const src = android ? (dataUrl || url) : url;
    return (
      <div className="w-full flex-1 min-h-0 flex flex-col bg-slate-100 dark:bg-slate-950">
        {src ? (
          <object data={src} type="application/pdf" className="w-full flex-1 min-h-[60vh] bg-white">
            <iframe title="Pratinjau Laporan PDF" src={src} className="w-full flex-1 min-h-[60vh] border-0 bg-white" />
          </object>
        ) : (
          <div className="p-6 text-sm text-slate-500">Memuat pratinjau PDF...</div>
        )}
        {url && (
          <div className="shrink-0 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 flex flex-wrap items-center justify-center gap-2">
            <a href={url} download="laporan.pdf" className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5">
              <Download className="w-4 h-4" /> Unduh PDF
            </a>
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm font-semibold px-4 py-2.5">
              <ExternalLink className="w-4 h-4" /> Buka
            </a>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full flex-1 min-h-0 flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center space-y-3 shadow-sm">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
          <FileText className="w-6 h-6" />
        </div>
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Pratinjau Excel tidak tersedia di tampilan ini.</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">Gunakan tombol unduh/buka untuk melihat laporan.</div>
        {url && (
          <a href={url} download={`laporan.${format}`} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5">
            <Download className="w-4 h-4" /> Unduh / Buka
          </a>
        )}
      </div>
    </div>
  );
}
