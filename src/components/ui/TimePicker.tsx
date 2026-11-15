import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock, ChevronDown } from 'lucide-react';

function pad2(n: number) { return String(n).padStart(2, '0'); }

function parseTime(v: string): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec((v || '').trim());
  if (!m) return { h: 0, m: 0 };
  const h = Math.max(0, Math.min(23, Number(m[1])));
  const mm = Math.max(0, Math.min(59, Number(m[2])));
  return { h, m: mm };
}

export interface TimePickerProps {
  value: string; // HH:mm
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  minuteStep?: number;
  id?: string;
}

export default function TimePicker({ value, onChange, disabled = false, className = '', placeholder = 'Pilih jam', minuteStep = 1, id }: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean; width: number } | null>(null);
  const parsed = useMemo(() => parseTime(value), [value]);

  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  const minutes = useMemo(() => {
    const step = Math.max(1, Math.min(30, minuteStep | 0 || 1));
    const arr: number[] = [];
    for (let i = 0; i < 60; i += step) arr.push(i);
    if (!arr.includes(parsed.m)) arr.push(parsed.m);
    return arr.sort((a,b) => a-b);
  }, [minuteStep, parsed.m]);

  const computePos = () => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const panelH = 320;
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const up = spaceBelow < Math.min(panelH, 220) && spaceAbove > spaceBelow;
    const width = Math.max(r.width, 220);
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8));
    const top = up ? Math.max(8, r.top - Math.min(panelH, spaceAbove)) : r.bottom + 6;
    setPos({ top, left, up, width });
  };

  useEffect(() => {
    if (!open) return;
    computePos();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = () => computePos();
    const onResize = () => computePos();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const setHM = (h: number, m: number) => {
    onChange(`${pad2(h)}:${pad2(m)}`);
  };

  const display = value && /^(\d{1,2}):(\d{2})$/.test(value) ? `${pad2(parsed.h)}:${pad2(parsed.m)}` : '';

  return (
    <>
      <button
        ref={btnRef}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        className={`w-full flex items-center justify-between gap-2 py-2.5 px-3.5 rounded-xl border text-sm font-medium transition-colors ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-slate-300 dark:hover:border-slate-600'
        } ${open ? 'border-blue-500 ring-2 ring-blue-500/20 bg-white dark:bg-slate-800/60' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60'} ${className}`}
      >
        <span className={`inline-flex items-center gap-2 min-w-0 ${display ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'}`}>
          <Clock className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="truncate font-mono">{display || placeholder}</span>
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && pos && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 2147483600 }}
          className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-2xl shadow-slate-950/25 overflow-hidden"
        >
          <div className="grid grid-cols-2 divide-x divide-slate-100 dark:divide-slate-700">
            <div className="p-2">
              <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Jam</div>
              <div className="max-h-56 overflow-y-auto custom-scrollbar space-y-1 pr-1">
                {hours.map((h) => {
                  const active = h === parsed.h;
                  return (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setHM(h, parsed.m)}
                      className={`w-full rounded-lg px-2.5 py-1.5 text-sm font-semibold text-center transition-colors ${active ? 'bg-blue-600 text-white' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60'}`}
                    >
                      {pad2(h)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="p-2">
              <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Menit</div>
              <div className="max-h-56 overflow-y-auto custom-scrollbar space-y-1 pr-1">
                {minutes.map((m) => {
                  const active = m === parsed.m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => { setHM(parsed.h, m); setOpen(false); }}
                      className={`w-full rounded-lg px-2.5 py-1.5 text-sm font-semibold text-center transition-colors ${active ? 'bg-blue-600 text-white' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60'}`}
                    >
                      {pad2(m)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="border-t border-slate-100 dark:border-slate-700 px-3 py-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 font-mono">{pad2(parsed.h)}:{pad2(parsed.m)} WIB</span>
            <button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600">Tutup</button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
