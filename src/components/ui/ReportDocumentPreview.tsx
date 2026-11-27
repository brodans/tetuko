import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, Loader2, Minus, Plus } from 'lucide-react';
import { saveBlobSmart, saveBlobToCacheAndOpen } from '../../lib/nativeSave';
import { isAndroidTetuko as isAndroidBridge, openReportOnAndroid } from '../../lib/androidNative';
import { isTauriRuntime } from '../../lib/nativeAutomation';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import * as XLSX from 'xlsx';

interface ReportDocumentPreviewProps { file: Blob; format: 'pdf' | 'xls'; }
type Cell = string;
type CellMerge = { row: number; col: number; rowSpan: number; colSpan: number };

function android(): boolean {
  return typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent) && (isTauriRuntime() || isAndroidBridge());
}
function mimeOf(file: Blob, format: 'pdf' | 'xls') {
  return file.type || (format === 'pdf' ? 'application/pdf' : 'application/vnd.ms-excel');
}
function filenameOf(file: Blob, format: 'pdf' | 'xls') {
  const mime = mimeOf(file, format).toLowerCase();
  return `laporan.${format === 'pdf' ? 'pdf' : mime.includes('csv') ? 'csv' : mime.includes('spreadsheet') || mime.includes('openxml') ? 'xlsx' : 'xls'}`;
}
function decodeEntities(value: string): string {
  const area = document.createElement('textarea'); area.innerHTML = value; return area.value;
}
function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toLocaleDateString('id-ID');
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toLocaleString('id-ID', { maximumFractionDigits: 12 });
  return String(value);
}
function readSheetRows(sheet: XLSX.WorkSheet): Cell[][] {
  const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  const rows: Cell[][] = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const row: Cell[] = [];
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })] as (XLSX.CellObject & { w?: string }) | undefined;
      row.push(cell?.w ?? formatCellValue(cell?.v));
    }
    rows.push(row);
  }
  return rows;
}
function decodeSpreadsheetBytes(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
function parseSpreadsheet(blobText: string): Cell[][] {
  const xml = new DOMParser().parseFromString(blobText, 'application/xml');
  const rows = [...xml.getElementsByTagNameNS('*', 'Row')];
  if (rows.length) return rows.map(row => [...row.getElementsByTagNameNS('*', 'Data')].map(cell => decodeEntities(cell.textContent || '')));

  // Fallback untuk CSV/HTML spreadsheet yang dikirim gateway tertentu.
  const html = new DOMParser().parseFromString(blobText, 'text/html');
  const htmlRows = [...html.querySelectorAll('tr')].map(row => [...row.querySelectorAll('th,td')].map(cell => cell.textContent?.trim() || ''));
  if (htmlRows.length) return htmlRows;
  const lines = blobText.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const delimiter = (lines[0] || '').includes(';') ? ';' : ',';
  return lines.map(line => {
    const cells: string[] = [];
    let value = ''; let quoted = false;
    for (const char of line) {
      if (char === '"') quoted = !quoted;
      else if (char === delimiter && !quoted) { cells.push(value.trim()); value = ''; }
      else value += char;
    }
    cells.push(value.trim());
    return cells.map(cell => cell.replace(/^"|"$/g, '').replace(/""/g, '"'));
  });
}

let workerConfigured = false;
function configurePdfWorker() {
  if (!workerConfigured) { pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl; workerConfigured = true; }
}

export default function ReportDocumentPreview({ file, format }: ReportDocumentPreviewProps) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [pdfPages, setPdfPages] = useState(0);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [pdfError, setPdfError] = useState('');
  const [sheetRows, setSheetRows] = useState<Cell[][]>([]);
  const [sheetMerges, setSheetMerges] = useState<CellMerge[]>([]);
  const [sheetName, setSheetName] = useState('');
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isAndroid = android();
  const filename = filenameOf(file, format);
  const mime = mimeOf(file, format);

  useEffect(() => {
    if (!file) return;
    const nextUrl = URL.createObjectURL(file); setUrl(nextUrl); setMessage('');
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  useEffect(() => {
    let cancelled = false;
    if (!file || format !== 'xls') { setSheetRows([]); return; }
    file.arrayBuffer().then(buffer => {
      if (cancelled) return;
      try {
        const workbook = XLSX.read(buffer, { type: 'array', cellText: true, cellDates: true });
        const names = workbook.SheetNames;
        const name = names[0] || 'Sheet1';
        const sheet = workbook.Sheets[name];
        const data = readSheetRows(sheet);
        setSheetNames(names); setActiveSheet(0); setSheetName(name);
        setSheetMerges((sheet['!merges'] || []).map((merge: XLSX.Range) => ({ row: merge.s.r, col: merge.s.c, rowSpan: merge.e.r - merge.s.r + 1, colSpan: merge.e.c - merge.s.c + 1 })));
        setSheetRows(data.length ? data : parseSpreadsheet(decodeSpreadsheetBytes(buffer)));
      } catch {
        setSheetRows(parseSpreadsheet(decodeSpreadsheetBytes(buffer)));
      }
    }).catch(() => { if (!cancelled) setSheetRows([]); });
    return () => { cancelled = true; };
  }, [file, format]);

  const changeSheet = useCallback(async (index: number) => {
    if (!file || format !== 'xls') return;
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellText: true, cellDates: true });
    const name = workbook.SheetNames[index];
    if (!name) return;
    const selectedSheet = workbook.Sheets[name];
    const rows = readSheetRows(selectedSheet);
    setActiveSheet(index); setSheetName(name);
    setSheetMerges((workbook.Sheets[name]['!merges'] || []).map((merge: XLSX.Range) => ({ row: merge.s.r, col: merge.s.c, rowSpan: merge.e.r - merge.s.r + 1, colSpan: merge.e.c - merge.s.c + 1 })));
    setSheetRows(rows);
  }, [file, format]);

  useEffect(() => {
    let cancelled = false;
    if (!file || format !== 'pdf') return;
    configurePdfWorker(); setPdfError(''); setPdfPages(0); setPage(1);
    file.arrayBuffer().then(async data => {
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
      if (!cancelled) setPdfPages(pdf.numPages);
    }).catch(e => { if (!cancelled) setPdfError(e?.message || 'PDF tidak dapat ditampilkan.'); });
    return () => { cancelled = true; };
  }, [file, format]);

  useEffect(() => {
    let cancelled = false;
    if (!file || format !== 'pdf' || !pdfPages || !canvasRef.current) return;
    configurePdfWorker();
    file.arrayBuffer().then(async data => {
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
      const pdfPage = await pdf.getPage(page);
      const viewport = pdfPage.getViewport({ scale: 1.25 * scale });
      const canvas = canvasRef.current; if (!canvas || cancelled) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
      await pdfPage.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined }).promise;
    }).catch(e => { if (!cancelled) setPdfError(e?.message || 'Halaman PDF gagal dirender.'); });
    return () => { cancelled = true; };
  }, [file, format, page, scale, pdfPages]);

  const openExternal = useCallback(async () => {
    setBusy(true); setMessage('');
    try {
      const ok = isAndroid ? await openReportOnAndroid(file, filename, mime) : isTauriRuntime() ? await saveBlobToCacheAndOpen(file, filename, mime).then(Boolean) : Boolean(window.open(url, '_blank', 'noopener,noreferrer'));
      if (!ok) setMessage('Aplikasi pembuka tidak tersedia. Gunakan tombol Unduh.');
    } catch (e: any) { setMessage(e?.message || 'Gagal membuka berkas.'); }
    finally { setBusy(false); }
  }, [file, filename, mime, url, isAndroid]);

  const download = useCallback(async () => {
    setBusy(true);
    try { await saveBlobSmart({ blob: file, filename, mimeHint: mime }); }
    catch (e: any) { setMessage(e?.message || 'Gagal menyimpan berkas.'); }
    finally { setBusy(false); }
  }, [file, filename, mime]);

  if (!file) return <div className="p-6 text-sm text-slate-500">Tidak ada dokumen.</div>;

  const toolbar = <div className="flex shrink-0 flex-col gap-2 border-b border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between sm:px-4">
    <div className="flex min-w-0 items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300"><FileText className="h-4 w-4 shrink-0 text-blue-500" /> <span className="truncate">{format === 'pdf' ? `PDF · Halaman ${page}/${pdfPages || '…'}` : 'Spreadsheet · pratinjau'}</span></div>
    <div className="flex w-full items-center gap-1.5 sm:w-auto">
      {format === 'pdf' && <><button type="button" onClick={() => setScale(v => Math.max(.7, v - .1))} className="rounded-lg border p-2" aria-label="Perkecil"><Minus className="h-4 w-4" /></button><span className="min-w-12 text-center text-xs">{Math.round(scale * 100)}%</span><button type="button" onClick={() => setScale(v => Math.min(2, v + .1))} className="rounded-lg border p-2" aria-label="Perbesar"><Plus className="h-4 w-4" /></button><button type="button" disabled={page <= 1} onClick={() => setPage(v => v - 1)} className="rounded-lg border p-2 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><button type="button" disabled={page >= pdfPages} onClick={() => setPage(v => v + 1)} className="rounded-lg border p-2 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></>}
      <button type="button" onClick={() => void openExternal()} disabled={busy} className="ml-auto inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-60 sm:ml-0 sm:flex-none"><ExternalLink className="h-4 w-4" /> Buka</button>
      <button type="button" onClick={() => void download()} disabled={busy} className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold sm:flex-none"><Download className="h-4 w-4" /> Unduh</button>
    </div>
  </div>;

  if (format === 'pdf') return <div className="flex min-h-0 flex-1 flex-col bg-slate-200 dark:bg-slate-950">{toolbar}<div className="min-h-0 flex-1 overflow-auto p-3 sm:p-6"><div className="mx-auto flex min-h-full w-fit items-start justify-center"><canvas ref={canvasRef} className="bg-white shadow-xl" />{!pdfPages && !pdfError && <Loader2 className="m-8 h-6 w-6 animate-spin text-slate-500" />}{pdfError && <div className="rounded-xl bg-white p-5 text-sm text-red-600">{pdfError}</div>}</div></div>{message && <div className="shrink-0 px-3 py-2 text-center text-xs text-rose-600">{message}</div>}</div>;

  return <div className="flex min-h-0 flex-1 flex-col bg-slate-100 dark:bg-slate-950">{toolbar}<div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">{sheetNames.map((name, index) => <button key={name} type="button" onClick={() => void changeSheet(index)} className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold ${index === activeSheet ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>{name}</button>)}</div><div className="min-h-0 flex-1 overflow-auto p-3 sm:p-5"><div className="mx-auto w-max min-w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900"><div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{sheetName || 'Spreadsheet'}</div><table className="border-collapse text-xs"><tbody>{sheetRows.length ? sheetRows.map((row, ri) => <tr key={ri} className={ri === 0 ? 'bg-emerald-50 font-bold dark:bg-emerald-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}>{row.map((cell, ci) => {
  const merge = sheetMerges.find(item => item.row === ri && item.col === ci);
  const covered = sheetMerges.some(item => ri >= item.row && ri < item.row + item.rowSpan && ci >= item.col && ci < item.col + item.colSpan && !(item.row === ri && item.col === ci));
  if (covered) return null;
  return <td key={ci} rowSpan={merge?.rowSpan} colSpan={merge?.colSpan} className="min-w-[120px] max-w-[360px] whitespace-pre-wrap break-words border border-slate-200 px-3 py-2 align-middle dark:border-slate-700">{cell}</td>;
})}</tr>) : <tr><td className="p-6 text-slate-500">Memuat spreadsheet…</td></tr>}</tbody></table></div></div>{message && <div className="shrink-0 px-3 py-2 text-center text-xs text-rose-600">{message}</div>}</div>;
}
