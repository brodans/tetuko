import React, { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { getTodayWIB } from '../lib/dateFormatter';
import type { PegawaiProfile } from '../lib/serverAutoLogin';
import { loadSession, saveSession, clearAllSessions } from '../lib/sessionManager';
import { getServerProfile, PROFILE_DEFAULT, type ServerProfile, type ServerProfileId } from '../lib/serverProfiles';
import { setActiveServerProfile } from '../lib/activeProfile';
import { DEFAULT_ADMIN_PERMISSIONS, type TabPermissions, type UserAccountSafe, type UserRole } from '../lib/userManager';
import { pathToRoute, slugToPageId, defaultPageForProfile } from '../lib/routes';

export type { PegawaiProfile };

// ─────────────────────────────────────────────────────────────────────────────
// Unified (BKD) App Context
// ─────────────────────────────────────────────────────────────────────────────

export interface LoginFormState {
  username: string;
  password: string;
  imei: string;
  profileId: ServerProfileId;
}

export interface LaporanLogState {
  dateStart: string;
  dateEnd: string;
  reportType: string;
  hasLoadedOnce: boolean;
}

export interface RiwayatPerizinanState {
  dateStart: string;
  dateEnd: string;
  rows: any[];
  hasLoadedOnce: boolean;
}

export type WebPresensiTab = 'imei' | 'kehadiran' | 'detail' | 'perizinan';
export interface WebPresensiState {
  sudahLogin: boolean;
  pemilikSesi: string | null;
  hasilImei: any;
  tab: WebPresensiTab;
  kehadiran: any;
  detail: any;
  ijinAjax: any[] | null;
  perizinan: any;
  semuaPerizinan: any[] | null;
  dimuat: { kehadiran: boolean; detail: boolean; perizinan: boolean };
}

const EMPTY_CONFIG = {
  deviceId: '',
  latitude: '',
  longitude: '',
  idLokasi: '',
  kodeInstansi: '',
  kodeUnor: '',
  workMode: '1',
  imei: '',
  lastLatLong: '',
};

interface AppContextType {
  pegawai: PegawaiProfile | null;
  setPegawai: React.Dispatch<React.SetStateAction<PegawaiProfile | null>>;
  serverProfileId: ServerProfileId;
  setServerProfileId: (id: ServerProfileId) => void;
  serverProfile: ServerProfile;
  serverConnected: boolean;
  setServerConnected: (value: boolean) => void;
  serverLoginError: string | null;
  setServerLoginError: (value: string | null) => void;
  serverAutoLoginPending: boolean;
  setServerAutoLoginPending: (value: boolean) => void;
  serverLogoutRequested: boolean;
  setServerLogoutRequested: (value: boolean) => void;
  loginForm: LoginFormState;
  setLoginForm: React.Dispatch<React.SetStateAction<LoginFormState>>;
  config: typeof EMPTY_CONFIG;
  setConfig: React.Dispatch<React.SetStateAction<typeof EMPTY_CONFIG>>;
  activePage: string;
  setActivePage: (page: string) => void;
  pathname: string;
  laporanLogState: LaporanLogState;
  setLaporanLogState: React.Dispatch<React.SetStateAction<LaporanLogState>>;
  riwayatPerizinanState: RiwayatPerizinanState;
  setRiwayatPerizinanState: React.Dispatch<React.SetStateAction<RiwayatPerizinanState>>;
  webPresensiState: WebPresensiState;
  setWebPresensiState: React.Dispatch<React.SetStateAction<WebPresensiState>>;
  developerMode: boolean;
  setDeveloperMode: (value: boolean) => void;
  logout: () => void;
  loginAs: (profile: PegawaiProfile, profileId: ServerProfileId, nip?: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

import { AUTOMATION_AVAILABLE } from '../lib/deployMode';

const PATH_MAP: Record<string, string> = {
  tabBeranda: '/beranda',
  tabPresensi: '/presensi',
  tabPerizinan: '/perizinan',
  tabLaporan: '/laporan',
  tabLokasiAbsen: '/lokasi-absen',
  tabWeb: '/web',
  ...(AUTOMATION_AVAILABLE ? { tabPresetOtomatisasi: '/preset-otomatisasi' } : {}),
};
export const PAGE_PATHS = PATH_MAP;

export function AppProvider({ children }: { children: ReactNode }) {
  const saved = loadSession();
  const [pegawai, setPegawai] = useState<PegawaiProfile | null>(saved?.profile ?? null);
  const [serverProfileId, _setServerProfileId] = useState<ServerProfileId>(saved?.profileId ?? PROFILE_DEFAULT);
  const [serverConnected, setServerConnected] = useState(Boolean(saved?.profile));
  const [serverLoginError, setServerLoginError] = useState<string | null>(null);
  const [serverAutoLoginPending, setServerAutoLoginPending] = useState(false);
  const [serverLogoutRequested, setServerLogoutRequested] = useState(false);
  const [loginForm, setLoginForm] = useState<LoginFormState>({ username: saved?.nip || (saved?.profile as any)?.nip || '', password: '', imei: '', profileId: saved?.profileId ?? PROFILE_DEFAULT });
  const [config, setConfig] = useState(EMPTY_CONFIG);
  const [activePage, setActivePage] = useState(() => {
    if (typeof window === 'undefined') return 'tabBeranda';
    const savedProfileId = saved?.profileId ?? PROFILE_DEFAULT;
    const prof = getServerProfile(savedProfileId);
    if (prof.mode === 'ponorogo-absensi') return 'tabBeranda';
    const r = pathToRoute(window.location.pathname);
    if (r.kind === 'app' && r.profileId === prof.id) {
      return slugToPageId(prof.id, prof.mode, r.pageId || '') || defaultPageForProfile(prof.id, prof.mode);
    }
    return defaultPageForProfile(prof.id, prof.mode);
  });
  const [pathname] = useState(() => (typeof window !== 'undefined' ? window.location.pathname : '/beranda'));
  const today = getTodayWIB();
  const [laporanLogState, setLaporanLogState] = useState<LaporanLogState>({ dateStart: today, dateEnd: today, reportType: 'log', hasLoadedOnce: false });
  const [riwayatPerizinanState, setRiwayatPerizinanState] = useState<RiwayatPerizinanState>({ dateStart: today, dateEnd: today, rows: [], hasLoadedOnce: false });
  const [webPresensiState, setWebPresensiState] = useState<WebPresensiState>({
    sudahLogin: false, pemilikSesi: null, hasilImei: null, tab: 'imei', kehadiran: null, detail: null,
    ijinAjax: null, perizinan: null, semuaPerizinan: null, dimuat: { kehadiran: false, detail: false, perizinan: false },
  });
  const [developerMode, setDeveloperMode] = useState(false);

  const serverProfile = useMemo(() => getServerProfile(serverProfileId), [serverProfileId]);

  React.useEffect(() => {
    setActiveServerProfile(serverProfileId);
  }, [serverProfileId]);

  const setServerProfileId = useCallback((id: ServerProfileId) => {
    _setServerProfileId(id);
    setActiveServerProfile(id);
    setLoginForm((f) => ({ ...f, profileId: id }));
  }, []);

  const loginAs = useCallback((profile: PegawaiProfile, profileId: ServerProfileId, nip?: string) => {
    setPegawai(profile);
    _setServerProfileId(profileId);
    setActiveServerProfile(profileId);
    setServerConnected(Boolean(profile));
    setServerLoginError(null);
    setServerLogoutRequested(false);
    saveSession(profile as any, profileId, nip || (profile as any).nip);
  }, []);

  const logout = useCallback(() => {
    setPegawai(null);
    setServerConnected(false);
    setServerLogoutRequested(true);
    clearAllSessions();
  }, []);

  const value = useMemo<AppContextType>(() => ({
    pegawai, setPegawai, serverProfileId, setServerProfileId, serverProfile,
    serverConnected, setServerConnected, serverLoginError, setServerLoginError,
    serverAutoLoginPending, setServerAutoLoginPending, serverLogoutRequested, setServerLogoutRequested,
    loginForm, setLoginForm, config, setConfig,
    activePage, setActivePage, pathname,
    laporanLogState, setLaporanLogState,
    riwayatPerizinanState, setRiwayatPerizinanState,
    webPresensiState, setWebPresensiState,
    developerMode, setDeveloperMode,
    logout, loginAs,
  }), [pegawai, serverProfileId, serverProfile, serverConnected, serverLoginError, serverAutoLoginPending, serverLogoutRequested, loginForm, config, activePage, pathname, laporanLogState, riwayatPerizinanState, webPresensiState, developerMode, logout, loginAs, setServerProfileId]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextType {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext harus dipakai di dalam AppProvider');
  return ctx;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ponorogo Context (bridge over unified app, same file - no separate *Ponorogo file)
// ─────────────────────────────────────────────────────────────────────────────

export interface InstansiLogState {
  dateStart: string; dateEnd: string; unorCode: string; selectedOPD: any | null;
  searchOPD: string; searchQuery: string; currentPage: number; pageSize: number;
  logs: any[]; totalElements: number; totalPages: number; hasLoadedOnce: boolean;
}

interface PonorogoPegawaiData {
  id?: string; nama?: string; nip?: string; nama_jabatan?: string; kelas_jabatan?: string;
  nama_instansi?: string; nama_lokasi?: string; foto?: string; password?: string;
  kode_unor?: string; alamat_kantor?: string; alamat?: string; unor?: string;
  nama_unit_kerja?: string; message?: string; [key: string]: any;
}

interface PonorogoKredensialConfig {
  idPegawai: string; deviceId: string; latitude: string; longitude: string;
  idLokasi: string; kodeInstansi: string; kodeUnor: string; workMode: string; versi: string;
}

interface PonorogoAppContextType {
  pegawai: PonorogoPegawaiData | null;
  setPegawai: (data: PonorogoPegawaiData | null | ((prev: PonorogoPegawaiData | null) => PonorogoPegawaiData | null)) => void;
  config: PonorogoKredensialConfig;
  setConfig: React.Dispatch<React.SetStateAction<PonorogoKredensialConfig>>;
  loginForm: { username: string; password: string };
  setLoginForm: React.Dispatch<React.SetStateAction<{ username: string; password: string }>>;
  developerMode: boolean;
  setDeveloperMode: (val: boolean) => void;
  datePickerStyle: 'modern' | 'klasik';
  setDatePickerStyle: (val: 'modern' | 'klasik') => void;
  activePage: string;
  setActivePage: (page: string) => void;
  instansiLogState: InstansiLogState;
  setInstansiLogState: React.Dispatch<React.SetStateAction<InstansiLogState>>;
  currentUser: UserAccountSafe | null;
  setCurrentUser: (user: UserAccountSafe | null) => void;
  userRole: UserRole;
  tabPermissions: TabPermissions;
  setTabPermissions: (perms: TabPermissions) => void;
  autoLoginTrigger: number;
}

const PonorogoAppContext = createContext<PonorogoAppContextType | undefined>(undefined);

export function PonorogoAppProvider({ children }: { children: ReactNode }) {
  const unified = useAppContext();
  const uPeg = unified.pegawai as any;

  const [activePage, setActivePage] = useState(() => {
    if (typeof window === 'undefined') return 'tabBeranda';
    const r = pathToRoute(window.location.pathname);
    if (r.kind === 'app' && r.profileId === 'ponorogo') {
      return slugToPageId('ponorogo', 'ponorogo-absensi', r.pageId || '') || 'tabBeranda';
    }
    return 'tabBeranda';
  });
  const [developerMode, setDeveloperModeState] = useState(false);
  const [datePickerStyle, setDatePickerStyleState] = useState<'modern' | 'klasik'>('modern');
  const [tabPermissions, setTabPermissionsState] = useState<TabPermissions>(DEFAULT_ADMIN_PERMISSIONS);
  const [loginForm, setLoginForm] = useState({ username: unified.loginForm.username || uPeg?.nip || '', password: '' });
  const [instansiLogState, setInstansiLogState] = useState<InstansiLogState>({
    dateStart: getTodayWIB(), dateEnd: getTodayWIB(), unorCode: '', selectedOPD: null,
    searchOPD: '', searchQuery: '', currentPage: 1, pageSize: 10, logs: [],
    totalElements: 0, totalPages: 0, hasLoadedOnce: false,
  });

  const [pegawai, setPegawai] = useState<PonorogoPegawaiData | null>(() => {
    if (!uPeg) return null;
    return {
      ...uPeg,
      id: String(uPeg.id || uPeg.pegawai_id || ''),
      nip: String(uPeg.nip || ''),
      nama: String(uPeg.nama || ''),
      foto: String(uPeg.profilePic || uPeg.foto || ''),
      nama_jabatan: String(uPeg.jabatan || uPeg.nama_jabatan || ''),
      nama_instansi: String(uPeg.instansi || uPeg.nama_instansi || ''),
      kode_unor: String(uPeg.kodeUnor || uPeg.kode_unor || ''),
      kode_instansi: String(uPeg.kodeInstansi || uPeg.kode_instansi || ''),
      id_lokasi: String(uPeg.idLokasi || uPeg.id_lokasi || ''),
      emai: String(uPeg.imei || ''),
      latitude: String(uPeg.latitude || ''),
      longitude: String(uPeg.longitude || ''),
    };
  });

  const [config, setConfig] = useState<PonorogoKredensialConfig>({
    idPegawai: String(uPeg?.id || ''),
    deviceId: String(uPeg?.imei || ''),
    latitude: String(uPeg?.latitude || ''),
    longitude: String(uPeg?.longitude || ''),
    idLokasi: String(uPeg?.idLokasi || ''),
    kodeInstansi: String(uPeg?.kodeInstansi || ''),
    kodeUnor: String(uPeg?.kodeUnor || ''),
    workMode: '1',
    versi: '2.0.0',
  });

  const currentUser: UserAccountSafe | null = useMemo(() => ({
    id: String(uPeg?.id || 'ponorogo-user'),
    username: String(uPeg?.nip || unified.loginForm.username || 'ponorogo'),
    displayName: String(uPeg?.nama || 'Pengguna Ponorogo'),
    role: 'admin',
    permissions: DEFAULT_ADMIN_PERMISSIONS,
    createdAt: 0,
    updatedAt: 0,
  }), [uPeg, unified.loginForm.username]);

  const value: PonorogoAppContextType = {
    pegawai,
    setPegawai: (data) => setPegawai(prev => typeof data === 'function' ? (data as any)(prev) : data),
    config, setConfig,
    loginForm, setLoginForm,
    developerMode,
    setDeveloperMode: (v) => setDeveloperModeState(v),
    datePickerStyle,
    setDatePickerStyle: (v) => setDatePickerStyleState(v),
    activePage, setActivePage,
    instansiLogState, setInstansiLogState,
    currentUser,
    setCurrentUser: () => { /* managed by unified app */ },
    userRole: 'admin',
    tabPermissions,
    setTabPermissions: (p) => setTabPermissionsState(p),
    autoLoginTrigger: 1,
  };

  return <PonorogoAppContext.Provider value={value}>{children}</PonorogoAppContext.Provider>;
}

export function usePonorogoAppContext() {
  const context = useContext(PonorogoAppContext);
  if (context === undefined) throw new Error('usePonorogoAppContext must be used within a PonorogoAppProvider');
  return context;
}

// Back-compat aliases so existing imports can be updated mechanically
export { PonorogoAppProvider as AppProviderPonorogo };
export { usePonorogoAppContext as useAppContextPonorogo };
