import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Server, LogIn, User, Lock, Eye, EyeOff, Moon, Sun, ArrowLeft, ShieldCheck, RefreshCw, Loader2, KeyRound, CheckCircle2, Settings, LogOut, Zap } from 'lucide-react';
import ServerHubPresetManager from './ServerHubPresetManager';
import { AUTOMATION_AVAILABLE } from '../lib/deployMode';
import { isTauriRuntime } from '../lib/nativeAutomation';
import { getAutostartEnabled, setAutostartEnabled, listenAutostartChanged } from '../lib/nativeTray';
import { useAppContext } from '../context/AppContext';
import { SERVER_PROFILES, type ServerProfileId } from '../lib/serverProfiles';
import { loginServerPusat, tandaiAktifServer, imeiStabil, simpanImei } from '../lib/serverAutoLogin';
import { APP_LOGO } from '../lib/appIdentity';
import { ambilImei, login as webLogin, logout as webLogout, muatCaptcha, setWebPresensiEpBase } from '../lib/webPresensi';
import { loadServerCreds, loadAllServerCreds, saveServerCreds, deleteServerCreds, setActiveServerCred, type SavedServerCreds } from '../lib/loginCredsStore';
import { loadAppAuthSession } from '../lib/appAuthSession';
import { isProfileAllowed } from '../lib/appUserManager';
import { saveNativeSessionContext } from '../lib/nativeSessionContextStore';
import AppAccountManagementModal from './AppAccountManagementModal';

type SavedCreds = SavedServerCreds;

interface Props {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  onAppLogout?: () => void;
}



export default function ServerHub({ isDarkMode, toggleDarkMode, onAppLogout }: Props) {
  const { loginAs, setServerProfileId } = useAppContext();
  const [selected, setSelected] = useState<ServerProfileId | null>(null);
  const [nip, setNip] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [needsCreds, setNeedsCreds] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMap, setSavedMap] = useState<Record<string, SavedCreds | null>>({});
  const [savedAccountsMap, setSavedAccountsMap] = useState<Record<string, SavedCreds[]>>({});
  const [showManage, setShowManage] = useState(false);
  const [hubTab, setHubTab] = useState<'server' | 'preset'>('server');
  const [autostartOn, setAutostartOn] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const isDesktopTauri = isTauriRuntime() && !/android/i.test(navigator.userAgent);
  const appSession = useMemo(() => loadAppAuthSession(), [showManage]);
  const isAppAdmin = appSession?.role === 'admin';
  const accountKey = (appSession?.user?.username || (isAppAdmin ? 'admin' : 'user')).toLowerCase();
  const canEditServerCreds = isAppAdmin || appSession?.permissions?.allowEditServerCreds !== false;
  const visibleProfiles = useMemo(() => {
    if (!appSession) return [];
    if (appSession.role === 'admin') return SERVER_PROFILES;
    return SERVER_PROFILES.filter(p => isProfileAllowed(appSession.permissions, p.id as ServerProfileId, appSession.role));
  }, [appSession]);

  // Web captcha / IMEI recovery (BKD: Jatim/Madiun)
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [captchaUrl, setCaptchaUrl] = useState<string | null>(null);
  const [captchaText, setCaptchaText] = useState('');
  const [captchaInfo, setCaptchaInfo] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveredImei, setRecoveredImei] = useState<string | null>(null);
  const captchaBlobRef = useRef<Blob | null>(null);

  const profile = useMemo(() => SERVER_PROFILES.find(p => p.id === selected) || null, [selected]);

  useEffect(() => {
    if (!isDesktopTauri) return;
    let un: (() => void) | null = null;
    (async () => {
      try { setAutostartOn(await getAutostartEnabled()); } catch {}
      try { un = await listenAutostartChanged((v) => setAutostartOn(v)); } catch {}
    })();
    return () => { try { un?.(); } catch {} };
  }, [isDesktopTauri]);

  const toggleAutostart = async () => {
    if (!isDesktopTauri || autostartBusy) return;
    setAutostartBusy(true);
    try {
      const next = !autostartOn;
      await setAutostartEnabled(next);
      setAutostartOn(next);
    } catch (e) {
      console.warn('Gagal mengubah autostart', e);
    } finally {
      setAutostartBusy(false);
    }
  };

  const resetRecovery = useCallback(() => {
    setRecoveryOpen(false);
    if (captchaUrl?.startsWith('blob:')) {
      try { URL.revokeObjectURL(captchaUrl); } catch {}
    }
    setCaptchaUrl(null);
    setCaptchaText('');
    setCaptchaInfo('');
    setCaptchaLoading(false);
    setRecoveryBusy(false);
    setRecoveredImei(null);
    captchaBlobRef.current = null;
  }, [captchaUrl]);

  const refreshSavedForProfile = useCallback(async (profileId: ServerProfileId) => {
    const [active, all] = await Promise.all([
      loadServerCreds(profileId, accountKey),
      loadAllServerCreds(profileId, accountKey),
    ]);
    setSavedMap(prev => ({ ...prev, [profileId]: active }));
    setSavedAccountsMap(prev => ({ ...prev, [profileId]: all }));
    return { active, all };
  }, [accountKey]);

  // Muat indikator kredensial tersimpan (Firestore, per akun app) untuk profil yang terlihat
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(SERVER_PROFILES.map(async (p) => {
        const [active, all] = await Promise.all([
          loadServerCreds(p.id as ServerProfileId, accountKey),
          loadAllServerCreds(p.id as ServerProfileId, accountKey),
        ]);
        return [p.id, active, all] as const;
      }));
      if (!cancelled) {
        const next: Record<string, SavedCreds | null> = {};
        const nextAll: Record<string, SavedCreds[]> = {};
        for (const [id, val, all] of entries) { next[id] = val; nextAll[id] = all; }
        setSavedMap(next);
        setSavedAccountsMap(nextAll);
      }
    })();
    return () => { cancelled = true; };
  }, [accountKey, showManage]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    resetRecovery();
    setNip('');
    setPassword('');
    setError(null);
    setNeedsCreds(true);
    (async () => {
      const { active } = await refreshSavedForProfile(selected);
      if (cancelled) return;
      setNip(active?.nip || '');
      setPassword(active?.password || '');
      // Jika user tidak boleh ubah kredensial dan kredensial lengkap: langsung masuk (tanpa isi form)
      if (!canEditServerCreds && active?.nip && active?.password) {
        void doLogin(selected, { nip: active.nip, password: active.password, imei: active.imei }, { showErrors: true, connectingUi: true, allowRecovery: true });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, accountKey, refreshSavedForProfile]);

  const loadCaptcha = useCallback(async (_hint = '') => {
    if (!profile) return;
    setCaptchaLoading(true);
    setCaptchaInfo(_hint || '');
    setCaptchaText('');
    setRecoveredImei(null);
    try {
      setWebPresensiEpBase(profile.epBaseUrl);
      const got = await muatCaptcha();
      if (captchaUrl?.startsWith('blob:')) { try { URL.revokeObjectURL(captchaUrl); } catch {} }
      captchaBlobRef.current = got.blob;
      setCaptchaUrl(got.url);
      setCaptchaInfo(_hint || 'Ketik kode captcha.');
    } catch (e: any) {
      setCaptchaInfo(`Gagal memuat captcha${e?.message ? `: ${e.message}` : ''}`);
    } finally {
      setCaptchaLoading(false);
    }
  }, [profile, captchaUrl]);

  const openRecovery = useCallback(async (_reason?: string) => {
    if (!profile || profile.mode !== 'bkd-rpc') return;
    setRecoveryOpen(true);
    setError(null);
    await loadCaptcha();
  }, [profile, loadCaptcha]);

  const doLogin = useCallback(async (
    pId: ServerProfileId,
    creds: { nip: string; password: string; imei?: string },
    opts?: { showErrors?: boolean; connectingUi?: boolean; allowRecovery?: boolean }
  ) => {
    const prof = SERVER_PROFILES.find(p => p.id === pId);
    if (!prof) return false;
    const showErrors = opts?.showErrors ?? true;
    const connectingUi = opts?.connectingUi ?? false;
    const allowRecovery = opts?.allowRecovery ?? true;

    if (connectingUi) setConnecting(true); else setLoading(true);
    setError(null);
    try {
      setServerProfileId(pId as ServerProfileId);
      const saved = savedMap[pId] ?? await loadServerCreds(pId, accountKey);
      const knownImei = prof.mode === 'bkd-rpc'
        ? (creds.imei?.trim() || saved?.imei?.trim() || imeiStabil(creds.nip, pId as ServerProfileId))
        : '';

      const hasil = await loginServerPusat(creds.nip.trim(), creds.password, pId as ServerProfileId, knownImei || undefined);
      if (hasil.status === 'berhasil' && hasil.profile) {
        const finalImei = String((hasil.profile as any)?.imei || knownImei || '');
        tandaiAktifServer(creds.nip.trim(), pId as ServerProfileId);
        if (prof.mode === 'bkd-rpc' && finalImei) simpanImei(creds.nip.trim(), finalImei, pId as ServerProfileId);
        const toSave: SavedCreds = { nip: creds.nip.trim(), password: creds.password, imei: prof.mode === 'bkd-rpc' ? (finalImei || undefined) : undefined };
        // simpan hanya jika akun ini diizinkan mengubah kredensialnya sendiri (atau admin)
        if (canEditServerCreds) {
          await saveServerCreds(pId, toSave, accountKey);
        }
        await refreshSavedForProfile(pId);
        try { await saveNativeSessionContext(pId, creds.nip.trim(), hasil.profile as any); } catch {}
        loginAs(hasil.profile as any, pId as ServerProfileId, creds.nip.trim());
        return true;
      }

      const pesanStr = typeof hasil.pesan === 'string'
        ? hasil.pesan
        : (() => { try { return JSON.stringify(hasil.pesan ?? 'Login gagal.'); } catch { return 'Login gagal.'; } })();

      // BKD: jika perangkat/IMEI bermasalah, tawarkan pemulihan IMEI via captcha web
      const indikasiImei = hasil.status === 'terkunci-perangkat' || /imei|perangkat|device|terikat|terkunci|sudah terdaftar/i.test(pesanStr);
      if (prof.mode === 'bkd-rpc' && allowRecovery && indikasiImei) {
        setNeedsCreds(true);
        if (showErrors) setError(pesanStr || 'Verifikasi perangkat diperlukan.');
        await openRecovery();
        return false;
      }

      if (showErrors) {
        setError(pesanStr || 'Login gagal. Periksa NIP/username, password, dan koneksi server presensi.');
        setNeedsCreds(true);
      }
      return false;
    } catch (err: any) {
      if (showErrors) {
        const raw = err?.message ?? err;
        const msg = typeof raw === 'string' ? raw : (() => { try { return JSON.stringify(raw ?? 'Terjadi kesalahan saat login.'); } catch { return 'Terjadi kesalahan saat login.'; } })();
        setError(msg || 'Terjadi kesalahan saat login.');
        setNeedsCreds(true);
      }
      return false;
    } finally {
      if (connectingUi) setConnecting(false); else setLoading(false);
    }
  }, [accountKey, canEditServerCreds, loginAs, openRecovery, savedMap, setServerProfileId]);

  // Tidak auto-login saat memilih server; pengguna menekan tombol Masuk secara manual.

  // Permintaan navigasi cepat dari tray (pilih server / langsung coba masuk jika kredensial tersimpan)
  useEffect(() => {
    const handler = async (ev: Event) => {
      const detail = (ev as CustomEvent<any>).detail || {};
      const profileId = detail.profileId as ServerProfileId | undefined;
      const autoLogin = detail.autoLogin !== false;
      if (!profileId) return;
      if (!visibleProfiles.some(p => p.id === profileId)) return;
      setError(null);
      setHubTab('server');
      const { active } = await refreshSavedForProfile(profileId);
      setSelected(profileId);
      if (autoLogin && active?.nip && active?.password) {
        setNeedsCreds(true);
        void doLogin(profileId, { nip: active.nip, password: active.password, imei: active.imei }, { showErrors: true, connectingUi: true, allowRecovery: true });
      } else {
        setNeedsCreds(true);
      }
    };
    window.addEventListener('tetuko-tray-open-profile', handler as any);
    return () => window.removeEventListener('tetuko-tray-open-profile', handler as any);
  }, [accountKey, doLogin, refreshSavedForProfile, visibleProfiles]);

  // Buka tab ServerHub tertentu dari tray (mis. Preset Otomasi)
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<any>).detail || {};
      if (detail.tab === 'preset') {
        setError(null);
        setConnecting(false);
        setNeedsCreds(false);
        setSelected(null);
        resetRecovery();
        setHubTab('preset');
      } else if (detail.tab === 'server') {
        setHubTab('server');
      }
    };
    window.addEventListener('tetuko-tray-open-hub', handler as any);
    return () => window.removeEventListener('tetuko-tray-open-hub', handler as any);
  }, [resetRecovery]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    if (!nip.trim() || !password) { setError('NIP/username dan password wajib diisi.'); return; }
    await doLogin(selected, { nip, password }, { showErrors: true, connectingUi: !recoveryOpen, allowRecovery: true });
  };

  const submitRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !profile || profile.mode !== 'bkd-rpc') return;
    if (!nip.trim() || !password) { setError('Isi NIP/username dan password terlebih dahulu.'); return; }
    if (!captchaText.trim()) { setError('Kode captcha wajib diisi.'); return; }

    setRecoveryBusy(true);
    setError(null);
    try {
      setWebPresensiEpBase(profile.epBaseUrl);
      await webLogin({ nip: nip.trim(), password, captcha: captchaText.trim() });
      const imeiData = await ambilImei();
      const imei = String(imeiData?.imei || '').trim();
      if (!imei) {
        setError('Login web berhasil, tetapi IMEI tidak ditemukan. Coba muat captcha ulang dan verifikasi kembali.');
        await loadCaptcha('Captcha baru dimuat.');
        return;
      }

      setRecoveredImei(imei);
      simpanImei(nip.trim(), imei, selected);
      // Coba logout sesi web (best effort) agar tidak menggantung sesi
      try { await webLogout(); } catch {}

      // Lanjut login ke server presensi dengan IMEI hasil web
      const ok = await doLogin(selected, { nip, password, imei }, { showErrors: true, connectingUi: true, allowRecovery: false });
      if (!ok) {
        setNeedsCreds(true);
      }
    } catch (err: any) {
      const msg = err?.message || 'Verifikasi web gagal.';
      setError(msg);
      await loadCaptcha(/captcha/i.test(String(msg)) ? 'Captcha salah/kadaluarsa. Captcha baru dimuat.' : 'Coba verifikasi ulang. Captcha baru dimuat.');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const selectedSaved = selected ? (savedMap[selected] ?? null) : null;
  const selectedSavedAccounts = selected ? (savedAccountsMap[selected] ?? []) : [];

  return (
    <div className="fixed inset-0 overflow-auto bg-slate-200 dark:bg-[#0a0f1c] p-4 sm:p-8" style={{ paddingTop: 'max(1rem, calc(var(--poni-atas, env(safe-area-inset-top, 0px)) + 1rem))', paddingBottom: 'max(1rem, calc(var(--poni-bawah, env(safe-area-inset-bottom, 0px)) + 1rem))' }}>
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#00000014_1px,transparent_1px),linear-gradient(to_bottom,#00000014_1px,transparent_1px)] bg-[size:24px_24px] dark:bg-[linear-gradient(to_right,#ffffff0a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0a_1px,transparent_1px)]" />
      </div>
      <button
        type="button"
        onClick={toggleDarkMode}
        className="fixed right-4 z-20 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 text-slate-700 dark:text-slate-200 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        style={{ top: 'max(1rem, calc(var(--poni-atas, env(safe-area-inset-top, 0px)) + 1rem))' }}
        aria-label="Toggle tema"
      >
        {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>

      <div className="relative z-10 min-h-full w-full flex items-center justify-center">
        <div className="w-full max-w-2xl rounded-3xl border border-slate-300 dark:border-slate-700/60 bg-white dark:bg-slate-900 shadow-xl shadow-slate-300/50 dark:shadow-slate-900/30 p-5 sm:p-7 md:p-8">
          <div className="pb-5 border-b border-slate-200/80 dark:border-slate-800">
            <div className="flex items-start gap-3 min-w-0">
              <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden shrink-0">
                <img src={APP_LOGO} alt="Logo" className="w-8 h-8 sm:w-9 sm:h-9 object-contain" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-600 dark:text-blue-400">TETUKO</div>
                    <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-slate-100 leading-tight">Pilih Server Presensi</h1>
                  </div>
                  {(isDesktopTauri || isAppAdmin || onAppLogout) && (
                    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                      {isDesktopTauri && (
                        <button
                          type="button"
                          onClick={() => void toggleAutostart()}
                          disabled={autostartBusy}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] sm:text-xs font-semibold transition-colors ${autostartOn ? 'border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'} disabled:opacity-60`}
                          title="Jalankan TETUKO otomatis saat komputer menyala"
                        >
                          <span className={`inline-flex h-3.5 w-3.5 sm:h-4 sm:w-4 items-center justify-center rounded border ${autostartOn ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-300 dark:border-slate-600 bg-transparent'}`}>
                            {autostartOn && <CheckCircle2 className="w-2.5 h-2.5 sm:w-3 sm:h-3" />}
                          </span>
                          <span className="hidden sm:inline">Mulai Saat Startup</span>
                          <span className="sm:hidden">Startup</span>
                        </button>
                      )}
                      {isAppAdmin && (
                        <button type="button" onClick={() => setShowManage(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-[11px] sm:text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700" title="Manajemen Akun & Konfigurasi">
                          <Settings className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> <span className="hidden sm:inline">Manajemen</span>
                        </button>
                      )}
                      {onAppLogout && (
                        <button type="button" onClick={onAppLogout} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/20 px-2.5 py-1.5 text-[11px] sm:text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/30" title="Keluar aplikasi">
                          <LogOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> <span className="hidden sm:inline">Keluar</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed">Masuk ke server presensi Anda.</p>
                {appSession && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    <span>Sesi:</span>
                    <span className="text-blue-600 dark:text-blue-400">@{appSession.user?.username || 'admin'}</span>
                    <span className="uppercase text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">{appSession.role}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="pt-5">
            {AUTOMATION_AVAILABLE && (
              <div className="mb-4 flex items-center gap-1 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/50 p-1">
                <button
                  type="button"
                  onClick={() => setHubTab('server')}
                  className={`flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${hubTab === 'server' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm border border-slate-200 dark:border-slate-700' : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'}`}
                >
                  <Server className="w-4 h-4" /> Server
                </button>
                <button
                  type="button"
                  onClick={() => setHubTab('preset')}
                  className={`flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${hubTab === 'preset' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm border border-slate-200 dark:border-slate-700' : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'}`}
                >
                  <Zap className="w-4 h-4" /> Preset
                </button>
              </div>
            )}

            {AUTOMATION_AVAILABLE && hubTab === 'preset' ? (
              <ServerHubPresetManager accountKey={accountKey} />
            ) : !selected ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {visibleProfiles.map((p) => {
                    const saved = savedMap[p.id];
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={async () => {
                          setError(null);
                          const saved = savedMap[p.id] ?? await loadServerCreds(p.id as ServerProfileId, accountKey);
                          setSavedMap(prev => ({ ...prev, [p.id]: saved }));
                          if (!canEditServerCreds && saved?.nip && saved?.password) {
                            // langsung masuk memakai kredensial yang ditetapkan admin
                            setSelected(p.id as ServerProfileId);
                            setNeedsCreds(true);
                            void doLogin(p.id as ServerProfileId, { nip: saved.nip, password: saved.password, imei: saved.imei }, { showErrors: true, connectingUi: true, allowRecovery: true });
                            return;
                          }
                          setSelected(p.id as ServerProfileId);
                        }}
                        className="group text-left rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 hover:border-blue-400/80 dark:hover:border-blue-500/70 hover:shadow-md hover:shadow-blue-900/5 p-4 transition-all"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center border border-blue-100 dark:border-blue-800/40">
                            <Server className="w-5 h-5" />
                          </div>
                          {saved?.nip ? (
                            <span className="inline-flex items-center rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40 px-2 py-0.5 text-[10px] font-semibold">Tersimpan</span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-[10px] font-semibold">Belum login</span>
                          )}
                        </div>
                        <div className="mt-3">
                          <div className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-snug">{p.nama}</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{p.label}</div>
                        </div>
                        {saved?.nip && <div className="mt-2 text-[10px] font-medium text-slate-500 dark:text-slate-400 truncate">Akun: {saved.nip}{!canEditServerCreds ? ' • dikunci admin' : ''}</div>}
                      </button>
                    );
                  })}
                </div>
                {visibleProfiles.length === 0 && (
                  <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
                    Akun Anda belum memiliki akses ke server presensi mana pun. Hubungi administrator.
                  </div>
                )}
              </div>
            ) : connecting && !needsCreds && !recoveryOpen ? (
              <div className="space-y-4">
                <button type="button" onClick={() => { setSelected(null); setError(null); setConnecting(false); setNeedsCreds(false); resetRecovery(); }} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                  <ArrowLeft className="w-3.5 h-3.5" /> Kembali ke pilihan server
                </button>
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700/70 bg-slate-50/80 dark:bg-slate-800/40 px-6 py-8 text-center">
                  <div className="mx-auto mb-4 h-10 w-10 rounded-full border-[3px] border-slate-200 dark:border-slate-700 border-t-blue-600 dark:border-t-blue-500 animate-spin" />
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Menghubungkan ke {profile?.nama}</div>
                  <div className="mt-1 flex items-center justify-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                    <span>Login otomatis ke server presensi</span>
                    <span className="inline-flex w-4 justify-start"><span className="animate-pulse">...</span></span>
                  </div>
                  {error && <div className="mt-4 rounded-xl border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/20 px-3 py-2 text-xs text-rose-700 dark:text-rose-300 whitespace-pre-wrap text-left">{error}</div>}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <button type="button" onClick={() => { setSelected(null); setError(null); setConnecting(false); resetRecovery(); }} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                    <ArrowLeft className="w-3.5 h-3.5" /> Kembali ke pilihan server
                  </button>
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/40 px-4 py-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center border border-blue-100 dark:border-blue-800/40 shrink-0">
                    <Server className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-snug">{profile?.nama}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{profile?.label}{selectedSaved?.nip ? ` • kredensial tersimpan (${selectedSaved.nip})${!canEditServerCreds ? ' • dikunci admin' : ''}` : (canEditServerCreds ? ' • masuk sekali untuk simpan otomatis' : ' • kredensial ditetapkan admin')}</div>
                  </div>
                </div>

                {error && (
                  <div className="rounded-xl border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/20 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300 whitespace-pre-wrap">
                    {typeof error === 'string' ? error : (() => { try { return JSON.stringify(error); } catch { return 'Terjadi kesalahan saat login.'; } })()}
                  </div>
                )}

                <form onSubmit={submit} className="space-y-4">
                  {selectedSavedAccounts.length > 0 && (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 p-2.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Akun tersimpan ({selectedSavedAccounts.length})</div>
                        {canEditServerCreds && (
                          <button
                            type="button"
                            onClick={() => { setNip(''); setPassword(''); setRecoveredImei(null); setError(null); setRecoveryOpen(false); }}
                            className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            Tambah akun
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedSavedAccounts.map((acc) => {
                          const active = acc.nip.trim().toLowerCase() === (nip || selectedSaved?.nip || '').trim().toLowerCase();
                          return (
                            <button
                              key={acc.nip}
                              type="button"
                              onClick={async () => {
                                setNip(acc.nip || '');
                                setPassword(acc.password || '');
                                setError(null);
                                if (selected) {
                                  try { await setActiveServerCred(selected, acc.nip, accountKey); } catch {}
                                  await refreshSavedForProfile(selected);
                                }
                              }}
                              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                              title={`Gunakan akun ${acc.nip}`}
                            >
                              <span className="truncate max-w-[160px]">{acc.nip}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-1">
                      <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">NIP / Username</label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          value={nip}
                          onChange={(e) => canEditServerCreds && setNip(e.target.value)}
                          readOnly={!canEditServerCreds}
                          className={`w-full rounded-xl border border-slate-200 dark:border-slate-700 pl-9 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-400 dark:focus:border-blue-500 ${canEditServerCreds ? 'bg-white dark:bg-slate-900/70 text-slate-800 dark:text-slate-100' : 'bg-slate-100 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 cursor-not-allowed'}`}
                          placeholder={canEditServerCreds ? "Masukkan NIP / username" : "Ditetapkan admin"}
                          autoComplete="username"
                          inputMode="text"
                        />
                      </div>
                    </div>
                    <div className="sm:col-span-1">
                      <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Password</label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          type={showPass ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => canEditServerCreds && setPassword(e.target.value)}
                          readOnly={!canEditServerCreds}
                          className={`w-full rounded-xl border border-slate-200 dark:border-slate-700 pl-9 pr-10 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-400 dark:focus:border-blue-500 ${canEditServerCreds ? 'bg-white dark:bg-slate-900/70 text-slate-800 dark:text-slate-100' : 'bg-slate-100 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 cursor-not-allowed'}`}
                          placeholder={canEditServerCreds ? "Masukkan password" : "Ditetapkan admin"}
                          autoComplete="current-password"
                        />
                        <button type="button" onClick={() => setShowPass(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300" aria-label={showPass ? 'Sembunyikan password' : 'Tampilkan password'}>
                          {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {!recoveryOpen && (
                    <div className="pt-1">
                      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
                        <button
                          type="submit"
                          disabled={loading || connecting || recoveryBusy}
                          className="sm:flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold px-4 py-2.5 text-sm transition-colors"
                        >
                          {(loading || connecting) ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                          {(loading || connecting) ? 'Menghubungkan...' : (selectedSaved?.nip ? 'Masuk' : (canEditServerCreds ? 'Simpan & Masuk' : 'Masuk'))}
                        </button>
                        {selectedSaved && canEditServerCreds && (
                          <button
                            type="button"
                            onClick={async () => {
                              if (!selected) return;
                              const targetNip = (nip || selectedSaved.nip || '').trim();
                              await deleteServerCreds(selected, accountKey, targetNip || undefined);
                              await refreshSavedForProfile(selected);
                              const next = (savedAccountsMap[selected] || []).filter(a => a.nip.trim().toLowerCase() !== targetNip.toLowerCase());
                              const active = next[0] || null;
                              setNip(active?.nip || '');
                              setPassword(active?.password || '');
                              setError(null); setNeedsCreds(true); resetRecovery();
                            }}
                            className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            Hapus Akun Ini
                          </button>
                        )}
                        {profile?.mode === 'bkd-rpc' && (
                          <button
                            type="button"
                            onClick={() => void openRecovery()}
                            disabled={loading || connecting || recoveryBusy || !nip.trim() || !password}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                          >
                            <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                            Verifikasi Baru
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </form>

                {recoveryOpen && profile?.mode === 'bkd-rpc' && (
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/30 p-3 sm:p-4 space-y-3">
                    <form onSubmit={submitRecovery} className="space-y-3">
                      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                        <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100 shrink-0">
                          <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                          Verifikasi Baru
                        </div>

                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 lg:gap-3 flex-1 min-w-0">
                          <div className="flex items-center gap-2 shrink-0">
                            <div className={`relative h-11 w-[191px] shrink-0 overflow-hidden rounded-xl border ${captchaUrl ? 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900' : 'border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900'}`}>
                              {captchaUrl ? (
                                <img src={captchaUrl} alt="Captcha" className="h-full w-full object-contain" />
                              ) : (
                                <div className="h-full w-full flex items-center justify-center text-[11px] text-slate-400">Captcha</div>
                              )}
                              {captchaLoading && <div className="absolute inset-0 bg-slate-200/40 dark:bg-slate-700/30 animate-pulse" aria-hidden="true" />}
                            </div>
                            <button
                              type="button"
                              onClick={() => void loadCaptcha()}
                              disabled={captchaLoading || recoveryBusy}
                              className="h-11 w-11 shrink-0 inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 hover:text-blue-600 hover:border-blue-300 dark:hover:text-blue-400 disabled:opacity-50 transition-colors"
                              title="Muat ulang captcha"
                              aria-label="Muat ulang captcha"
                            >
                              <RefreshCw className={`w-4 h-4 ${captchaLoading ? 'animate-spin' : ''}`} />
                            </button>
                          </div>

                          <div className="flex-1 min-w-0">
                            <input
                              value={captchaText}
                              onChange={(e) => setCaptchaText(e.target.value.replace(/\s/g, ''))}
                              className="w-full h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-400 dark:focus:border-blue-500 tracking-[0.12em]"
                              placeholder="Kode captcha"
                              autoComplete="one-time-code"
                              inputMode="numeric"
                              maxLength={8}
                              aria-label="Kode Captcha"
                            />
                          </div>
                        </div>
                      </div>

                      {(captchaInfo || recoveredImei) && (
                        <div className="flex flex-wrap items-center gap-2">
                          {captchaInfo && <span className="text-[11px] text-slate-500 dark:text-slate-400">{captchaInfo}</span>}
                          {recoveredImei && (
                            <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                              <CheckCircle2 className="w-3.5 h-3.5" /> IMEI tersimpan
                            </span>
                          )}
                        </div>
                      )}

                      <div className="flex flex-col sm:flex-row gap-2">
                        <button
                          type="submit"
                          disabled={recoveryBusy || captchaLoading || connecting || loading}
                          className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold py-2.5 text-sm transition-colors"
                        >
                          {recoveryBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                          {recoveryBusy ? 'Memverifikasi...' : 'Verifikasi & Masuk'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setRecoveryOpen(false); setRecoveredImei(null); setError(null); }}
                          disabled={recoveryBusy}
                          className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
                        >
                          Tutup
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {showManage && isAppAdmin && (
        <AppAccountManagementModal onClose={() => { setShowManage(false); }} />
      )}
    </div>
  );
}
