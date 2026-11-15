import { useMemo, useState } from 'react';
import { Image as ImageIcon, Plus, Loader2, X, Trash2, AlertTriangle } from 'lucide-react';
import {
  isProbablyImageFile, sniffImageKind, decodeImageUniversal, scaleCanvasMaxSide, canvasToJpeg,
} from '../../lib/universalImage';
import ImageLightbox from './ImageLightbox';

const LONG_SIDE = 320;
const DEFAULT_MAX_STOCK = 20;

export interface StockFotoItem {
  id: string;
  nama: string;
  dataUrl: string;
  ukuranAsli: number;
  lebarPx: number;
  tinggiPx: number;
  dibuatPada?: number;
}

export interface StockFotoManagerProps {
  fotos: StockFotoItem[];
  selectedIds?: string[];
  onSelect?: (ids: string[]) => void;
  onTambah: (data: Omit<StockFotoItem, 'id' | 'dibuatPada'>) => Promise<StockFotoItem | null | void>;
  onHapus: (id: string) => Promise<void>;
  maxSelect?: number;
  maxStock?: number;
  readOnly?: boolean;
  /** 'card' = BKD style, 'plain' = Ponorogo/automasi style */
  variant?: 'card' | 'plain';
  onChanged?: () => void;
}

async function processFoto(file: File): Promise<{ dataUrl: string; w: number; h: number; sizeOri: number; err?: string }> {
  const sizeOri = file.size;
  if (!isProbablyImageFile(file)) return { dataUrl: '', w: 0, h: 0, sizeOri, err: 'Format file tidak didukung.' };
  try {
    const kind = await sniffImageKind(file);
    const decoded = await decodeImageUniversal(file, kind);
    const scaled = scaleCanvasMaxSide(decoded, LONG_SIDE);
    const dataUrl = canvasToJpeg(scaled.canvas, 0.92);
    return { dataUrl, w: scaled.w, h: scaled.h, sizeOri };
  } catch (e: any) {
    return { dataUrl: '', w: 0, h: 0, sizeOri, err: e?.message || 'Gagal memproses foto.' };
  }
}

export default function StockFotoManager({
  fotos, selectedIds = [], onSelect, onTambah, onHapus,
  maxSelect = DEFAULT_MAX_STOCK, maxStock = DEFAULT_MAX_STOCK,
  readOnly = false, variant = 'plain', onChanged,
}: StockFotoManagerProps) {
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; title: string } | null>(null);
  const [hapusTarget, setHapusTarget] = useState<string | null>(null);
  const [hapusSemuaOpen, setHapusSemuaOpen] = useState(false);
  const [hapusBerjalan, setHapusBerjalan] = useState(false);

  const slotTersisa = Math.max(0, maxStock - fotos.length);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const changed = () => {
    try { onChanged?.(); } catch {}
    try { if (typeof window !== 'undefined') { window.dispatchEvent(new CustomEvent('presensi-automasi-updated')); window.dispatchEvent(new Event('presensi-preset-updated')); } } catch {}
  };

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (!arr.length) return;
    setErrors([]); setUploading(true); setProgress({ done: 0, total: arr.length });
    const errs: string[] = [];
    let did = false;
    for (let i = 0; i < arr.length; i++) {
      const file = arr[i];
      try {
        const r = await processFoto(file);
        if (!r.dataUrl) { errs.push(`${file.name}: ${r.err || 'Gagal'}`); }
        else {
          const nama = file.name.replace(/\.[^.]+$/, '').slice(0, 60) || `Foto ${Date.now()}`;
          const saved = await onTambah({ nama, dataUrl: r.dataUrl, ukuranAsli: r.sizeOri, lebarPx: r.w, tinggiPx: r.h });
          if (saved !== null) did = true;
        }
      } catch (e: any) { errs.push(`${file.name}: ${e?.message || 'Error'}`); }
      setProgress({ done: i + 1, total: arr.length });
    }
    setUploading(false); setProgress(null);
    if (errs.length) setErrors(errs);
    if (did) changed();
  };

  const toggle = (id: string) => {
    if (!onSelect || readOnly) return;
    if (selectedIds.includes(id)) onSelect(selectedIds.filter(x => x !== id));
    else if (selectedIds.length < maxSelect) onSelect([...selectedIds, id]);
  };

  const hapusSatu = async (id: string) => {
    try { await onHapus(id); } finally { setHapusTarget(null); changed(); }
  };
  const hapusSemua = async () => {
    setHapusBerjalan(true);
    for (const f of fotos) { try { await onHapus(f.id); } catch {} }
    setHapusBerjalan(false); setHapusSemuaOpen(false); changed();
  };

  const Upload = ({ className, children }: { className?: string; children: React.ReactNode }) => (
    <div className={`relative ${className || ''}`}>
      {children}
      <input
        type="file" accept="image/*,.heic,.heif,.tif,.tiff,.bmp,.ico,.avif,.jxl" multiple
        disabled={uploading || readOnly}
        onChange={e => { const files = Array.from(e.currentTarget.files ?? []); e.currentTarget.value = ''; if (files.length) void handleFiles(files); }}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: uploading || readOnly ? 'not-allowed' : 'pointer', zIndex: 10 }}
      />
    </div>
  );

  const inner = (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-bold text-slate-500 dark:text-slate-400">
            {fotos.length}<span className="font-normal text-slate-400">/{maxStock}</span>
          </span>
          {onSelect && (
            <span className="text-slate-400">· <span className="font-bold text-slate-600 dark:text-slate-300">{selectedIds.length}</span>/{maxSelect} dipilih</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {!readOnly && fotos.length > 0 && (
            <button type="button" onClick={() => setHapusSemuaOpen(true)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors">
              <Trash2 className="w-3.5 h-3.5" /> Hapus Semua
            </button>
          )}
          {!readOnly && slotTersisa > 0 && (
            <Upload className="rounded-xl">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-600 text-white shadow-sm select-none pointer-events-none ${uploading ? 'opacity-60' : ''}`}>
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Tambah Foto
              </div>
            </Upload>
          )}
        </div>
      </div>

      {errors.length > 0 && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/10 p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {errors.length} foto gagal</span>
            <button type="button" onClick={() => setErrors([])} className="text-rose-400 hover:text-rose-600"><X className="w-3.5 h-3.5" /></button>
          </div>
          {errors.slice(0, 4).map((e, i) => <p key={i} className="text-[11px] text-rose-600 dark:text-rose-400 truncate">{e}</p>)}
        </div>
      )}

      {uploading && progress && (
        <div className="rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
            <span className="text-xs font-bold text-blue-700 dark:text-blue-300">Memproses {progress.done}/{progress.total}…</span>
          </div>
          <div className="h-1.5 bg-blue-200 dark:bg-blue-900 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {fotos.length === 0 && !uploading ? (
        !readOnly ? (
          <Upload className="w-full rounded-2xl">
            <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 p-8 text-center transition-colors group pointer-events-none">
              <ImageIcon className="w-8 h-8 mb-2 text-slate-300 dark:text-slate-600 group-hover:text-blue-400 transition-colors" />
              <span className="text-xs font-bold text-slate-400 dark:text-slate-500">Belum ada foto</span>
              <span className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Ketuk untuk memilih — bisa banyak sekaligus</span>
            </div>
          </Upload>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-sm text-slate-500">Belum ada foto.</div>
        )
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          {fotos.map((foto) => {
            const selected = selectedSet.has(foto.id);
            const order = selected ? selectedIds.indexOf(foto.id) + 1 : 0;
            const canSel = selected || selectedIds.length < maxSelect;
            return (
              <div key={foto.id} className={`relative group rounded-xl overflow-hidden border ${selected ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-slate-200 dark:border-slate-700'} ${onSelect && !selected && !canSel && !readOnly ? 'opacity-40' : ''}`}>
                <button type="button" className="block w-full aspect-square bg-slate-100 dark:bg-slate-800" onClick={() => { if (onSelect && !readOnly) toggle(foto.id); else setLightbox({ src: foto.dataUrl, title: foto.nama }); }} disabled={!!(onSelect && !selected && !canSel && !readOnly)}>
                  <img src={foto.dataUrl} alt={foto.nama} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                </button>
                {selected && <div className="absolute top-1 left-1 w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center shadow pointer-events-none">{order}</div>}
                {!readOnly && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); setHapusTarget(foto.id); }} className="absolute top-1 right-1 w-6 h-6 bg-rose-500/80 hover:bg-rose-600 text-white rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow">
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
                <div className="px-1.5 py-1 text-[10px] truncate bg-white/90 dark:bg-slate-900/80">{foto.nama}</div>
              </div>
            );
          })}
          {!readOnly && slotTersisa > 0 && !uploading && (
            <Upload className="aspect-square rounded-xl">
              <div className="w-full h-full aspect-square rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 flex flex-col items-center justify-center gap-1 transition-colors pointer-events-none">
                <Plus className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">{slotTersisa}</span>
              </div>
            </Upload>
          )}
        </div>
      )}

      {onSelect && <div className="text-[11px] text-slate-500">Dipilih untuk preset: {selectedIds.length}/{maxSelect}</div>}

      {lightbox && <ImageLightbox src={lightbox.src} title={lightbox.title} onClose={() => setLightbox(null)} />}

      {hapusTarget && (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/10 p-4 space-y-3">
          <div>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Hapus foto ini?</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Foto dihapus permanen dari penyimpanan dan semua preset.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setHapusTarget(null)} className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 transition-colors">Batal</button>
            <button type="button" onClick={() => void hapusSatu(hapusTarget)} className="flex-1 py-2 rounded-xl bg-rose-600 text-xs font-bold text-white hover:bg-rose-700 transition-colors">Hapus</button>
          </div>
        </div>
      )}

      {hapusSemuaOpen && (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/10 p-4 space-y-3">
          <div>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Hapus semua {fotos.length} foto?</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Semua foto dihapus permanen dari penyimpanan dan semua preset.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setHapusSemuaOpen(false)} disabled={hapusBerjalan} className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 transition-colors disabled:opacity-50">Batal</button>
            <button type="button" onClick={() => void hapusSemua()} disabled={hapusBerjalan} className="flex-1 py-2 rounded-xl bg-rose-600 text-xs font-bold text-white hover:bg-rose-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
              {hapusBerjalan ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Menghapus…</> : 'Hapus Semua'}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  if (variant === 'card') {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="text-sm font-bold text-slate-800 dark:text-slate-100">Stock Foto Presensi ({fotos.length}/{maxStock})</div>
        {inner}
      </div>
    );
  }
  return inner;
}

// Back-compat named export for callers expecting MAX_STOCK_FOTO constant context
export const MAX_STOCK_FOTO = DEFAULT_MAX_STOCK;
