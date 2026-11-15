import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Lock, LogIn, AlertCircle, Eye, EyeOff, Clock, CheckCircle2, Sun, Moon, User, ShieldAlert, Hexagon } from 'lucide-react';
import { verifyAdminCredentials, verifyAppUserPassword, sanitizeStr, DEFAULT_ADMIN_APP_PERMISSIONS } from '../lib/appUserManager';
import type { AppUserSafe, AppUserPermissions } from '../lib/appUserManager';
import { createAdminAppUser, saveAppAuthSession } from '../lib/appAuthSession';
import { APP_LOGO } from '../lib/appIdentity';

interface Props {
  onLogin: () => void;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
}

const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 5 * 60 * 1000;
const MAX_USERNAME_LEN = 32;
const MAX_PASSWORD_LEN = 128;
const MIN_AUTH_DELAY_MS = 800;
const LS_ATTEMPTS = 'tetuko_login_attempts';
const LS_COOLDOWN = 'tetuko_cooldown_until';

type AuthStatus = 'IDLE' | 'AUTHENTICATING' | 'LOCKED' | 'SUCCESS';
interface AuthState { status: AuthStatus; username: string; pin: string; attempts: number; cooldownUntil: number | null; errorMessage: string | null; }
type AuthAction =
  | { type: 'SET_USERNAME'; payload: string }
  | { type: 'SET_PIN'; payload: string }
  | { type: 'START_AUTH' }
  | { type: 'AUTH_SUCCESS' }
  | { type: 'AUTH_FAILED'; payload: { attempts: number; cooldownUntil?: number; errorMsg: string } }
  | { type: 'UPDATE_COOLDOWN'; payload: number | null };

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'SET_USERNAME': return { ...state, username: action.payload.substring(0, MAX_USERNAME_LEN) };
    case 'SET_PIN': return { ...state, pin: action.payload.substring(0, MAX_PASSWORD_LEN) };
    case 'START_AUTH': return { ...state, status: 'AUTHENTICATING', errorMessage: null };
    case 'AUTH_SUCCESS': return { ...state, status: 'SUCCESS', pin: '', errorMessage: null };
    case 'AUTH_FAILED': return { ...state, status: action.payload.cooldownUntil ? 'LOCKED' : 'IDLE', attempts: action.payload.attempts, cooldownUntil: action.payload.cooldownUntil ?? state.cooldownUntil, errorMessage: action.payload.errorMsg, pin: '' };
    case 'UPDATE_COOLDOWN': return { ...state, cooldownUntil: action.payload, status: action.payload && action.payload > Date.now() ? 'LOCKED' : 'IDLE' };
    default: return state;
  }
}

function sanitizeUsername(val: string): string { return sanitizeStr(val, MAX_USERNAME_LEN).toLowerCase().replace(/\s/g, ''); }
function sanitizePassword(val: string): string { return val.replace(/[\x00-\x1F\x7F]/g, '').substring(0, MAX_PASSWORD_LEN); }

export default function AppLoginScreen({ onLogin, isDarkMode, toggleDarkMode }: Props) {
  const [state, dispatch] = useReducer(authReducer, { status: 'IDLE', username: '', pin: '', attempts: 0, cooldownUntil: null, errorMessage: null });
  const [showPin, setShowPin] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const authInFlight = useRef(false);

  useEffect(() => {
    try {
      const savedAttempts = parseInt(localStorage.getItem(LS_ATTEMPTS) || '0', 10);
      const savedCooldown = parseInt(localStorage.getItem(LS_COOLDOWN) || '0', 10);
      if (savedCooldown && savedCooldown > Date.now()) {
        dispatch({ type: 'AUTH_FAILED', payload: { attempts: savedAttempts, cooldownUntil: savedCooldown, errorMsg: 'Sistem terkunci sementara.' } });
      } else if (savedAttempts > 0) {
        localStorage.setItem(LS_ATTEMPTS, '0');
        localStorage.removeItem(LS_COOLDOWN);
      }
    } catch {}
  }, []);

  useEffect(() => {
    let iv: any;
    if (state.cooldownUntil && state.cooldownUntil > Date.now()) {
      iv = setInterval(() => {
        const rem = Math.ceil((state.cooldownUntil! - Date.now()) / 1000);
        if (rem <= 0) {
          setTimeLeft(0);
          dispatch({ type: 'UPDATE_COOLDOWN', payload: null });
          try { localStorage.removeItem(LS_COOLDOWN); localStorage.setItem(LS_ATTEMPTS, '0'); } catch {}
        } else setTimeLeft(rem);
      }, 1000);
    }
    return () => iv && clearInterval(iv);
  }, [state.cooldownUntil]);

  const fmtTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const handleAuthentication = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (authInFlight.current) return;
    if (state.status === 'LOCKED' || state.cooldownUntil) {
      dispatch({ type: 'AUTH_FAILED', payload: { attempts: state.attempts, errorMsg: `Akses ditolak. Tunggu ${fmtTime(timeLeft)}.` } });
      return;
    }
    const uname = sanitizeUsername(state.username);
    const pass = sanitizePassword(state.pin);
    if (!uname || !pass) { dispatch({ type: 'AUTH_FAILED', payload: { attempts: state.attempts, errorMsg: 'ID pengguna dan kata sandi wajib diisi.' } }); return; }

    authInFlight.current = true;
    dispatch({ type: 'START_AUTH' });
    const t0 = Date.now();
    try {
      let authenticated = false;
      let loginUser: AppUserSafe | null = null;
      let loginPerms: AppUserPermissions = DEFAULT_ADMIN_APP_PERMISSIONS;

      // 1) Admin (settings/app_auth)
      if (await verifyAdminCredentials(uname, pass)) {
        authenticated = true;
        loginUser = createAdminAppUser(uname);
        loginPerms = DEFAULT_ADMIN_APP_PERMISSIONS;
      }

      // 2) User (tetuko_users)
      if (!authenticated) {
        const u = await verifyAppUserPassword(uname, pass);
        if (u) { authenticated = true; loginUser = u; loginPerms = u.permissions; }
      }

      const elapsed = Date.now() - t0;
      if (elapsed < MIN_AUTH_DELAY_MS) await new Promise(r => setTimeout(r, MIN_AUTH_DELAY_MS - elapsed));

      if (authenticated && loginUser) {
        try { localStorage.setItem(LS_ATTEMPTS, '0'); localStorage.removeItem(LS_COOLDOWN); } catch {}
        saveAppAuthSession({ user: loginUser, role: loginUser.role, permissions: loginPerms });
        dispatch({ type: 'AUTH_SUCCESS' });
        setTimeout(() => onLogin(), 700);
      } else {
        throw new Error('invalid');
      }
    } catch {
      const elapsed = Date.now() - t0;
      if (elapsed < MIN_AUTH_DELAY_MS) await new Promise(r => setTimeout(r, MIN_AUTH_DELAY_MS - elapsed));
      const nextAttempts = state.attempts + 1;
      try { localStorage.setItem(LS_ATTEMPTS, String(nextAttempts)); } catch {}
      if (nextAttempts >= MAX_ATTEMPTS) {
        const lockUntil = Date.now() + COOLDOWN_MS;
        try { localStorage.setItem(LS_COOLDOWN, String(lockUntil)); } catch {}
        dispatch({ type: 'AUTH_FAILED', payload: { attempts: nextAttempts, cooldownUntil: lockUntil, errorMsg: 'Terlalu banyak percobaan gagal. Sistem dikunci 5 menit.' } });
      } else {
        dispatch({ type: 'AUTH_FAILED', payload: { attempts: nextAttempts, errorMsg: `Kredensial salah. ${MAX_ATTEMPTS - nextAttempts} percobaan tersisa.` } });
      }
    } finally {
      authInFlight.current = false;
    }
  };

  const isLocked = state.status === 'LOCKED';
  const isAuthing = state.status === 'AUTHENTICATING';
  const canSubmit = !isLocked && !isAuthing && sanitizeUsername(state.username).length > 0 && sanitizePassword(state.pin).length > 0;

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 sm:p-8 font-sans bg-slate-200 dark:bg-[#0a0f1c] overflow-hidden">
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#00000014_1px,transparent_1px),linear-gradient(to_bottom,#00000014_1px,transparent_1px)] bg-[size:24px_24px] dark:bg-[linear-gradient(to_right,#ffffff0a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0a_1px,transparent_1px)]" />
      </div>

      <div className="absolute top-6 right-6 z-20">
        <button onClick={toggleDarkMode} className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" aria-label="Toggle tema">
          {isDarkMode ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-indigo-500" />}
        </button>
      </div>

      <div className="relative z-10 w-full max-w-[26rem] bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-2xl shadow-xl shadow-slate-300/50 dark:shadow-none overflow-hidden">
        <div className="px-8 pt-10 pb-6 text-center relative">
          <div className="inline-flex items-center justify-center w-20 h-20 mb-6">
            <div className="flex items-center justify-center w-full h-full bg-slate-100 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-3 overflow-hidden">
              <img src={APP_LOGO} alt="TETUKO" className="h-full w-full object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} />
              <Hexagon className="hidden w-8 h-8 text-indigo-600 dark:text-indigo-400" />
            </div>
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">TETUKO</h1>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-2 uppercase tracking-[0.2em]">Masuk ke Aplikasi</p>
        </div>

        <div className="px-8 pb-10 relative">
          {state.status === 'SUCCESS' && (
            <div className="absolute inset-0 z-30 bg-white dark:bg-slate-900 flex flex-col justify-center items-center rounded-b-2xl">
              <div className="w-20 h-20 bg-emerald-50 dark:bg-emerald-500/10 rounded-2xl flex items-center justify-center mb-6">
                <CheckCircle2 className="w-10 h-10 text-emerald-500" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Autentikasi Berhasil</h2>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 animate-pulse">Menyiapkan akses...</p>
            </div>
          )}

          <form onSubmit={handleAuthentication} className="space-y-6" autoComplete="off">
            {state.errorMessage && (
              <div className={`flex items-start gap-3 p-4 rounded-xl text-sm font-medium border ${isLocked ? 'bg-red-50/80 border-red-200 text-red-700 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-400' : 'bg-amber-50/80 border-amber-200 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400'}`}>
                {isLocked ? <ShieldAlert className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
                <span className="leading-relaxed">{state.errorMessage}</span>
              </div>
            )}

            <div className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="login-username" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider ml-1">ID Pengguna</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400 group-focus-within:text-indigo-500"><User className="h-5 w-5" /></div>
                  <input id="login-username" type="text" value={state.username} disabled={isLocked || isAuthing} onChange={e => dispatch({ type: 'SET_USERNAME', payload: e.target.value })} className="block w-full pl-11 pr-4 py-3.5 bg-slate-50 dark:bg-slate-950/50 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all disabled:opacity-50" placeholder="Masukkan ID Anda" autoComplete="username" />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center ml-1">
                  <label htmlFor="login-password" className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Kata Sandi</label>
                  {isLocked && <span className="text-[10px] font-bold text-red-600 dark:text-red-400 flex items-center gap-1 bg-red-100 dark:bg-red-500/20 px-2 py-1 rounded-md"><Clock className="w-3 h-3" /> {fmtTime(timeLeft)}</span>}
                </div>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400 group-focus-within:text-indigo-500"><Lock className="h-5 w-5" /></div>
                  <input id="login-password" type={showPin ? 'text' : 'password'} value={state.pin} disabled={isLocked || isAuthing} onChange={e => dispatch({ type: 'SET_PIN', payload: e.target.value })} className="block w-full pl-11 pr-12 py-3.5 bg-slate-50 dark:bg-slate-950/50 border border-slate-300 dark:border-slate-700 rounded-xl text-base font-mono tracking-widest text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all disabled:opacity-50" placeholder={isLocked ? 'TERKUNCI' : '••••••••'} autoComplete="current-password" />
                  <div className="absolute inset-y-0 right-1 flex items-center pr-2">
                    <button type="button" onClick={() => setShowPin(!showPin)} disabled={isLocked || isAuthing} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-300 dark:hover:bg-slate-800 transition-all"><span className="sr-only">toggle</span>{showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                  </div>
                </div>
              </div>
            </div>

            <button type="submit" disabled={!canSubmit} className={`w-full flex justify-center items-center gap-2 py-3.5 px-6 rounded-xl text-sm font-bold text-white transition-colors ${isAuthing ? 'bg-indigo-500 cursor-wait' : isLocked || !canSubmit ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
              {isAuthing ? (<><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /><span>Memverifikasi...</span></>) : isLocked ? (<><Lock className="w-5 h-5" /><span>Akses Tertutup</span></>) : (<><span>Masuk ke Sistem</span><LogIn className="w-5 h-5" /></>)}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
