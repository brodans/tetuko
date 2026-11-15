import { useEffect, useState } from 'react';

interface ReportDocumentPreviewProps {
  file: Blob;
  format: 'pdf' | 'xls';
}

export default function ReportDocumentPreview({ file, format }: ReportDocumentPreviewProps) {
  const [url, setUrl] = useState<string>('');

  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  if (!file) {
    return <div className="p-6 text-sm text-slate-500">Tidak ada dokumen untuk ditampilkan.</div>;
  }

  if (format === 'pdf') {
    return (
      <div className="w-full h-[70vh] min-h-[480px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        {url ? (
          <iframe title="Pratinjau Laporan PDF" src={url} className="w-full h-full" />
        ) : (
          <div className="p-6 text-sm text-slate-500">Memuat pratinjau PDF...</div>
        )}
      </div>
    );
  }

  // XLS/XLSX: browser/tauri webview may not render; offer open/download
  return (
    <div className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center space-y-3">
      <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Pratinjau XLS tidak tersedia di tampilan ini.</div>
      <div className="text-xs text-slate-500 dark:text-slate-400">Gunakan tombol unduh/buka untuk melihat laporan Excel.</div>
      {url && (
        <a href={url} download={`laporan.${format}`} className="inline-flex items-center justify-center rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5">
          Unduh / Buka Laporan
        </a>
      )}
    </div>
  );
}
