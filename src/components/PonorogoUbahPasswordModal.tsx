import { useState } from 'react';
import { CheckCircle2, Eye, EyeOff, Lock, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { sendRequest } from '../api';
import { usePonorogoAppContext } from '../context/AppContext';

export default function PonorogoUbahPasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pegawai, config } = usePonorogoAppContext() as any;
  const [pwdNow, setPwdNow] = useState('');
  const [pwdNew, setPwdNew] = useState('');
  const [showPwdNow, setShowPwdNow] = useState(false);
  const [showPwdNew, setShowPwdNew] = useState(false);
  const [output, setOutput] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const tutup = () => {
    if (loading) return;
    setPwdNow('');
    setPwdNew('');
    setShowPwdNow(false);
    setShowPwdNew(false);
    setOutput(null);
    onClose();
  };

  const simpan = async () => {
    if (!pwdNow || !pwdNew) { setOutput({ type: 'error', text: 'Password tidak boleh kosong.' }); return; }
    setLoading(true);
    setOutput(null);
    try {
      const data = await sendRequest('/login/Ubah_PasswordMobile', {
        id_pegawai: config?.idPegawai || pegawai?.id || (pegawai as any)?.id_pegawai,
        password_sekarang: pwdNow,
        password_baru: pwdNew,
      });
      if (data?.success) {
        setOutput({ type: 'success', text: `Password berhasil diubah. ${data.message || ''}`.trim() });
        setPwdNow(pwdNew);
        setPwdNew('');
      } else {
        setOutput({ type: 'error', text: `Gagal mengubah password. ${data?.message || ''}`.trim() });
      }
    } catch (err: any) {
      setOutput({ type: 'error', text: `Network Error: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="modal-layer fixed inset-0 z-[200] flex items-center justify-center p-4 overflow-y-auto">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} onClick={tutup} className="absolute inset-0 bg-slate-950/70" />
          <motion.div initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 8 }} transition={{ duration: 0.18, ease: 'easeOut' }} className="relative w-full max-w-md my-auto bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 z-10 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <div className="flex items-center gap-2.5"><div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0"><Lock className="w-4 h-4 text-blue-600 dark:text-blue-400" /></div><span className="font-bold text-slate-800 dark:text-white text-sm">Ubah Password Mobile</span></div>
              <button type="button" onClick={tutup} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Password Sekarang</label>
                <div className="relative">
                  <input type={showPwdNow ? 'text' : 'password'} value={pwdNow} onChange={e => setPwdNow(e.target.value)} className="w-full px-4 py-3 border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none pr-10 transition-colors" />
                  <button type="button" onClick={() => setShowPwdNow(v => !v)} className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">{showPwdNow ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Password Baru</label>
                <div className="relative">
                  <input type={showPwdNew ? 'text' : 'password'} value={pwdNew} onChange={e => setPwdNew(e.target.value)} className="w-full px-4 py-3 border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none pr-10 transition-colors" />
                  <button type="button" onClick={() => setShowPwdNew(v => !v)} className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">{showPwdNew ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button>
                </div>
              </div>
              {output && (
                <div className={`p-3.5 rounded-xl text-xs font-semibold border flex items-start gap-2 ${output.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30' : 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/30'}`}>
                  {output.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />}
                  <span>{output.text}</span>
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-3 shrink-0 bg-slate-50/80 dark:bg-slate-900/80">
              <button type="button" onClick={tutup} disabled={loading} className="py-2.5 px-4 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-sm transition-colors disabled:opacity-50">Batal</button>
              <button type="button" onClick={() => void simpan()} disabled={loading} className="py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-colors">{loading ? 'Menyimpan...' : 'Simpan'}</button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
