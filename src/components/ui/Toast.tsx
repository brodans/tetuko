import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info';

interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

interface ToastOptions {
  kind?: ToastKind;
  durationMs?: number;
  action?: ToastAction;
}

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

interface ToastApi {
  show: (message: string, kind?: ToastKind, options?: Omit<ToastOptions, 'kind'>) => void;
  success: (message: string, options?: Omit<ToastOptions, 'kind'>) => void;
  error: (message: string, options?: Omit<ToastOptions, 'kind'>) => void;
  info: (message: string, options?: Omit<ToastOptions, 'kind'>) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const KIND_STYLES: Record<ToastKind, { icon: typeof Info; ring: string; iconColor: string }> = {
  success: { icon: CheckCircle2, ring: 'border-emerald-200 dark:border-emerald-900/60', iconColor: 'text-emerald-500' },
  error: { icon: AlertCircle, ring: 'border-rose-200 dark:border-rose-900/60', iconColor: 'text-rose-500' },
  info: { icon: Info, ring: 'border-blue-200 dark:border-blue-900/60', iconColor: 'text-blue-500' },
};

let sequence = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const show = useCallback(
    (message: string, kind: ToastKind = 'info', options?: Omit<ToastOptions, 'kind'>) => {
      const id = ++sequence;
      const action = options?.action;
      setToasts(prev => [...prev.slice(-3), { id, kind, message, action }]);
      const duration = options?.durationMs ?? (kind === 'error' ? 7000 : action ? 8000 : 3500);
      if (duration > 0) setTimeout(() => remove(id), duration);
    },
    [remove]
  );

  const api = useMemo<ToastApi>(
    () => ({
      show: (message, kind = 'info', options) => show(message, kind, options),
      success: (message, options) => show(message, 'success', options),
      error: (message, options) => show(message, 'error', options),
      info: (message, options) => show(message, 'info', options),
    }),
    [show]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}

      <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[110] flex flex-col items-end gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map(toast => {
            const { icon: Icon, ring, iconColor } = KIND_STYLES[toast.kind];
            return (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: 20, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, scale: 0.96 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className={`pointer-events-auto w-full sm:w-auto sm:max-w-md flex items-start gap-3 rounded-xl border ${ring} bg-white/95 dark:bg-slate-800/95 px-4 py-3 shadow-xl`}
                role="status"
              >
                <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${iconColor}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed break-words">
                    {toast.message}
                  </p>
                  {toast.action && (
                    <button
                      type="button"
                      onClick={async () => {
                        try { await toast.action?.onClick(); } finally { remove(toast.id); }
                      }}
                      className="mt-2 inline-flex items-center rounded-lg px-2.5 py-1.5 text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white transition-colors"
                    >
                      {toast.action.label}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove(toast.id)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors shrink-0"
                  aria-label="Tutup notifikasi"
                >
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
}
