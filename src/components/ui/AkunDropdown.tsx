import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { UserCircle } from 'lucide-react';

export interface AkunDropdownItem {
  id: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  onClick: () => void;
  tone?: 'default' | 'danger';
}

export interface AkunDropdownProps {
  displayName: string;
  photoUrl?: string | null;
  roleLabel?: string;
  subtitle?: string;
  items: AkunDropdownItem[];
}

const LEBAR_MENU = 264;
const MARGIN = 12;

export default function AkunDropdown({ displayName, photoUrl, roleLabel, subtitle, items }: AkunDropdownProps) {
  const [open, setOpen] = useState(false);
  const [lebar, setLebar] = useState(LEBAR_MENU);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updatePos = () => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const ruang = window.innerWidth - MARGIN * 2;
    const w = Math.max(200, Math.min(LEBAR_MENU, ruang));
    setLebar(w);
    const left = Math.min(Math.max(MARGIN, r.right - w), window.innerWidth - w - MARGIN);
    const top = r.bottom + 8;
    setPos({ top, left });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  const avatar = (size: 'sm' | 'md') => {
    const cls = size === 'sm' ? 'w-8 h-8 text-[11px]' : 'w-10 h-10 text-xs';
    if (photoUrl) {
      return <img src={photoUrl} alt={displayName} className={`${cls} rounded-full object-cover aspect-square border border-slate-200 dark:border-slate-600 shrink-0`} />;
    }
    return (
      <div className={`${cls} rounded-full flex items-center justify-center shrink-0 border bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30 font-bold`}>
        {initials || <UserCircle className="w-4 h-4" />}
      </div>
    );
  };

  const menu = open ? createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, y: -6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
          role="menu"
          style={{ width: lebar, position: 'fixed', top: pos.top, left: pos.left }}
          className="z-[999] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl shadow-slate-950/20 overflow-hidden"
        >
          <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-700/60">
            {avatar('md')}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-slate-800 dark:text-slate-100 break-words leading-snug">{displayName}</p>
              {(subtitle || roleLabel) && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {roleLabel && <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300">{roleLabel}</span>}
                  {subtitle && <span className="text-[11px] text-slate-500 dark:text-slate-400 break-words">{subtitle}</span>}
                </div>
              )}
            </div>
          </div>
          <div className="p-1.5 space-y-0.5">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); item.onClick(); }}
                className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-md text-left transition-colors ${
                  item.tone === 'danger'
                    ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                }`}
              >
                {item.icon && <span className="mt-0.5 shrink-0">{item.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-bold">{item.label}</span>
                  {item.hint && <span className="block text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 break-words leading-snug">{item.hint}</span>}
                </span>
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  ) : null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Menu akun — ${displayName}`}
        title={displayName}
        className={`flex items-center rounded-full border transition-all cursor-pointer ${
          open
            ? 'border-blue-400 dark:border-blue-500/60 ring-2 ring-blue-500/20'
            : 'border-slate-200 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-md'
        } p-0.5 sm:pr-2.5 sm:gap-2 bg-white/70 dark:bg-slate-800/70 shadow-sm`}
      >
        {avatar('sm')}
        <span className="hidden sm:inline text-sm font-semibold text-slate-700 dark:text-slate-200 max-w-[130px] truncate">{displayName}</span>
        <svg className={`hidden sm:block w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {menu}
    </div>
  );
}
