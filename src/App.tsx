import React, { Suspense, useMemo, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Camera, Globe, MapPin, FileCheck, FileText, Home, Zap,
  Activity, Database as DatabaseIcon, Edit3, BarChart3, Building2, Network, Bot, LogOut, Code2, AlertTriangle, X, KeyRound,
} from 'lucide-react';
import { usePresensiServerOnline } from './hooks/usePresensiServerOnline';
import type { LucideIcon } from 'lucide-react';
import { useDarkMode } from './hooks/useDarkMode';
import { AppProvider, PonorogoAppProvider, useAppContext, usePonorogoAppContext } from './context/AppContext';
import { ToastProvider } from './components/ui/Toast';
import GlobalPresetScheduler from './components/GlobalPresetScheduler';
import AppShellLayout from './components/AppShellLayout';
import ServerHub from './components/ServerHub';
import DeveloperInspector from './components/DeveloperInspector';
import AppLoginScreen from './components/AppLoginScreen';
import ProfilServerAkunModal from './components/ProfilServerAkunModal';
import PonorogoUbahPasswordModal from './components/PonorogoUbahPasswordModal';
import { apiUrl } from './lib/apiBase';
import { AUTOMATION_AVAILABLE } from './lib/deployMode';
import { navigateTo, pageToPath, pathToRoute, slugToPageId, defaultPageForProfile } from './lib/routes';
import { tandaiKeluarServer } from './lib/serverAutoLogin';
import { rpcLogout } from './lib/apiCalls';
import { loadAppAuthSession, clearAppAuthSession, touchAppAuthSession } from './lib/appAuthSession';
import { isMenuAllowed, isProfileAllowed } from './lib/appUserManager';

type PageModule = { default: React.ComponentType };
const pageImporters = {
  tabBeranda: () => import('./pages/Beranda'),
  tabPresensi: () => import('./pages/Presensi'),
  tabPerizinan: () => import('./pages/Perizinan'),
  tabLaporan: () => import('./pages/Laporan'),
  tabLokasiAbsen: () => import('./pages/LokasiAbsen'),
  tabWeb: () => import('./pages/WebPresensi'),
  ...(AUTOMATION_AVAILABLE ? { tabPresetOtomatisasi: () => import('./pages/PresetOtomatisasi') } : {}),
} as Record<string, () => Promise<PageModule>>;


const pageModuleCache = new Map<string, Promise<PageModule>>();
const loadPageModule = (pageId: string): Promise<PageModule> => {
  const importer = pageImporters[pageId as keyof typeof pageImporters];
  if (!importer) return Promise.reject(new Error(`Halaman ${pageId} tidak tersedia.`));
  const cached = pageModuleCache.get(pageId);
  if (cached) return cached;
  const promise = importer().catch(error => { pageModuleCache.delete(pageId); throw error; });
  pageModuleCache.set(pageId, promise);
  return promise;
};
function LazyPage({ pageId }: { pageId: string }) {
  const module = React.use(loadPageModule(pageId));
  const Component = module.default;
  return <Component />;
}
const lazyPage = (pageId: string): React.ComponentType => () => <LazyPage pageId={pageId} />;
const Beranda = lazyPage('tabBeranda');
const Presensi = lazyPage('tabPresensi');
const Perizinan = lazyPage('tabPerizinan');
const Laporan = lazyPage('tabLaporan');
const LokasiAbsen = lazyPage('tabLokasiAbsen');
const WebPresensi = lazyPage('tabWeb');
const PresetOtomatisasi = AUTOMATION_AVAILABLE ? lazyPage('tabPresetOtomatisasi') : null;

interface PageDefinition { id: string; icon: LucideIcon; label: string; component: React.ComponentType; }
const BKD_PAGES: PageDefinition[] = [
  { id: 'tabBeranda', icon: Home, label: 'Beranda', component: Beranda },
  { id: 'tabPresensi', icon: Camera, label: 'Presensi', component: Presensi },
  { id: 'tabPerizinan', icon: FileCheck, label: 'Perizinan', component: Perizinan },
  { id: 'tabLaporan', icon: FileText, label: 'Laporan', component: Laporan },
  { id: 'tabLokasiAbsen', icon: MapPin, label: 'Lokasi Absen', component: LokasiAbsen },
  ...(AUTOMATION_AVAILABLE && PresetOtomatisasi ? [{ id: 'tabPresetOtomatisasi', icon: Zap, label: 'Preset Auto', component: PresetOtomatisasi } as PageDefinition] : []),
  { id: 'tabWeb', icon: Globe, label: 'WEB', component: WebPresensi },
];

function ConfirmLogoutModal({ open, onCancel, onConfirm }: { open: boolean; onCancel: () => void; onConfirm: () => void | Promise<void>; }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) setBusy(false); }, [open]);
  if (!open) return null;
  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  };
  return createPortal(
    <div className="fixed inset-0 z-[2147483600] flex items-center justify-center bg-slate-950/50 p-4" onClick={() => !busy && onCancel()}>
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-slate-900 dark:text-white">Keluar / Ganti Server?</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Sesi server saat ini akan diakhiri dan Anda akan kembali ke pilihan server.</div>
          </div>
          <button type="button" onClick={() => !busy && onCancel()} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60">Batal</button>
          <button type="button" onClick={() => void handleConfirm()} disabled={busy} className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold disabled:opacity-60">
            <LogOut className="w-4 h-4" /> {busy ? 'Memproses...' : 'Ya, Keluar'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function PageFallback() {
  const [showReset, setShowReset] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setShowReset(true), 6000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="min-h-[50vh] w-full flex items-center justify-center p-6">
      <div className="flex flex-col items-center justify-center text-center gap-3">
        <div className="h-10 w-10 rounded-full border-2 border-slate-200 dark:border-slate-700 border-t-blue-600 animate-spin" />
        <div className="text-sm font-medium text-slate-600 dark:text-slate-300">Memuat halaman...</div>
        {showReset && (
          <button
            onClick={() => { try { localStorage.removeItem('presensi_local_session_v1'); sessionStorage.clear(); } catch {} window.location.href = window.location.pathname + '?reset=1'; }}
            className="mt-1 px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-100 text-xs font-semibold"
          >
            Terlalu lama? Reset & ke Login
          </button>
        )}
      </div>
    </div>
  );
}

function BkdShell({ isDarkMode, toggleDarkMode, devInspectorOpen, onToggleInspector, routePageSlug }: { isDarkMode: boolean; toggleDarkMode: () => void; devInspectorOpen: boolean; onToggleInspector: () => void; routePageSlug?: string | null; }) {
  const { pegawai, activePage, setActivePage, logout, serverProfile, loginForm } = useAppContext();
  const serverStatus = usePresensiServerOnline();
  const appSession = loadAppAuthSession();
  const [profilServerOpen, setProfilServerOpen] = useState(false);
  const allowedBkdPages = useMemo(() => BKD_PAGES.filter(p => isMenuAllowed(appSession?.permissions as any, serverProfile.id, p.id, (appSession?.role as any) || 'user')), [appSession, serverProfile.id]);

  if (!pegawai) return null;

  const lastAppliedRouteSlug = React.useRef<string | null | undefined>(undefined);

  // Sinkronkan hanya saat slug URL berubah dari luar (refresh/deep-link/popstate), bukan saat klik menu internal.
  React.useEffect(() => {
    if (routePageSlug === lastAppliedRouteSlug.current) return;
    lastAppliedRouteSlug.current = routePageSlug;
    if (!routePageSlug) return;
    const pid = slugToPageId(serverProfile.id, serverProfile.mode, routePageSlug);
    if (pid && pid !== activePage) setActivePage(pid);
  }, [routePageSlug, serverProfile.id, serverProfile.mode, activePage, setActivePage]);

  React.useEffect(() => {
    // Hindari menimpa URL deep-link saat sinkronisasi awal dari route slug
    if (routePageSlug) {
      const expectedPid = slugToPageId(serverProfile.id, serverProfile.mode, routePageSlug);
      if (expectedPid && expectedPid !== activePage) return;
    }
    const path = pageToPath(serverProfile.id, serverProfile.mode, activePage);
    if (window.location.pathname !== path) navigateTo(path, true);
  }, [activePage, serverProfile.id, serverProfile.mode, routePageSlug]);

  useEffect(() => {
    const allowed = allowedBkdPages.some(p => p.id === activePage);
    if (!allowed) {
      const fallback = allowedBkdPages[0]?.id || 'tabBeranda';
      if (fallback !== activePage) setActivePage(fallback);
    }
  }, [activePage, allowedBkdPages, setActivePage]);

  const effectivePageId = allowedBkdPages.some(p => p.id === activePage) ? activePage : (allowedBkdPages[0]?.id || 'tabBeranda');
  const page = allowedBkdPages.find((p) => p.id === effectivePageId) ?? BKD_PAGES[0];
  const Page = page.component;

  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false);
  const doLogout = async () => {
    try { if ((pegawai as any).apiKey) await rpcLogout({ apiKey: (pegawai as any).apiKey, imei: (pegawai as any).imei }); } catch {}
    try { tandaiKeluarServer(loginForm.username || (pegawai as any).nip || '', serverProfile.id); } catch {}
    logout();
    setConfirmLogoutOpen(false);
    navigateTo('/login', true);
  };
  const requestLogout = () => setConfirmLogoutOpen(true);

  const displayName = (pegawai as any).nama || (pegawai as any).nip || loginForm.username || 'Pengguna';
  const nip = (pegawai as any).nip || loginForm.username || '';
  const rawPhoto = (pegawai as any).profilePic || (pegawai as any).foto || '';
  const accountPhotoUrl = rawPhoto
    ? (rawPhoto.startsWith('data:') || rawPhoto.startsWith('blob:')
        ? rawPhoto
        : rawPhoto.startsWith('http://') || rawPhoto.startsWith('https://')
          ? apiUrl(`/api/proxy-image?path=${encodeURIComponent(rawPhoto)}`)
          : apiUrl(`/api/proxy-image?path=${encodeURIComponent(rawPhoto.startsWith('/') ? rawPhoto : `/${rawPhoto}`)}`))
    : null;

  return (
    <>
      <AppShellLayout
        brandTitle={serverProfile.nama}
        brandSubtitle={serverProfile.label}
        pages={allowedBkdPages.map(p => ({ id: p.id, label: p.label, icon: p.icon }))}
        activePageId={page.id}
        onSelectPage={setActivePage}
        onLogout={requestLogout}
        isDarkMode={isDarkMode}
        toggleDarkMode={toggleDarkMode}
        headerTitle={page.label}
        headerSubtitle={`${displayName}${nip ? ` · ${nip}` : ''}`}
        footer={AUTOMATION_AVAILABLE ? <GlobalPresetScheduler /> : undefined}
        statusLabel={serverStatus === 'online' ? 'Online' : 'Offline'}
        statusTone={serverStatus === 'online' ? 'emerald' : 'amber'}
        rightPanel={<DeveloperInspector enabled={devInspectorOpen} onClose={onToggleInspector} />}
        account={{
          displayName,
          photoUrl: accountPhotoUrl,
          roleLabel: serverProfile.label,
          subtitle: nip || serverProfile.nama,
          items: [
            {
              id: 'profil-server',
              label: 'Profil Akun Server',
              hint: 'Ubah profil dan password di server',
              icon: <KeyRound className="w-4 h-4 text-blue-500" />,
              onClick: () => setProfilServerOpen(true),
            },
            {
              id: 'dev-inspector',
              label: 'Developer Inspector',
              hint: devInspectorOpen ? 'Panel dev aktif (buka/tutup)' : 'Buka panel network/API inspector',
              icon: <Code2 className="w-4 h-4 text-sky-500" />,
              onClick: onToggleInspector,
            },
            {
              id: 'logout-server',
              label: 'Keluar / Ganti Server',
              hint: 'Putuskan sesi server dan kembali ke pilihan server',
              icon: <LogOut className="w-4 h-4 text-rose-500" />,
              tone: 'danger',
              onClick: requestLogout,
            },
          ],
        }}
      >
        <Suspense fallback={<PageFallback />}>
          <Page />
        </Suspense>
      </AppShellLayout>
      {profilServerOpen && <ProfilServerAkunModal onClose={() => setProfilServerOpen(false)} />}
      <ConfirmLogoutModal open={confirmLogoutOpen} onCancel={() => setConfirmLogoutOpen(false)} onConfirm={doLogout} />
    </>
  );
}

type PonorogoPageModule = { default: React.ComponentType };
const ponorogoPageImporters = {
  tabBeranda: () => import('./pages/LoginServer'),
  tabAbsen: () => import('./pages/Presensi'),
  tabLog: () => import('./pages/LogPresensi'),
  tabInputAktivitas: () => import('./pages/Produktivitas'),
  tabAktivitas: () => import('./pages/LogProduktivitas'),
  tabIzin: () => import('./pages/Izin'),
  tabLogPresensiInstansi: () => import('./pages/LogPresensiInstansi'),
  tabReview: () => import('./pages/ReviewProduktivitas'),
  tabDatabase: () => import('./pages/Database'),
  tabUnor: () => import('./pages/Unor'),
  tabReport: () => import('./pages/Laporan'),
  ...(AUTOMATION_AVAILABLE ? { tabAutomasi: () => import('./pages/Automasi') } : {}),
} as Record<string, () => Promise<PonorogoPageModule>>;

const ponorogoPageModuleCache = new Map<string, Promise<PonorogoPageModule>>();
const loadPonorogoPageModule = (pageId: string): Promise<PonorogoPageModule> => {
  const importer = ponorogoPageImporters[pageId as keyof typeof ponorogoPageImporters];
  if (!importer) return Promise.reject(new Error(`Halaman ${pageId} tidak tersedia.`));
  const cached = ponorogoPageModuleCache.get(pageId);
  if (cached) return cached;
  const promise = importer().catch(error => { ponorogoPageModuleCache.delete(pageId); throw error; });
  ponorogoPageModuleCache.set(pageId, promise);
  return promise;
};

const PonorogoLazyPage = React.memo(function PonorogoLazyPage({ pageId }: { pageId: string }) {
  const module = React.use(loadPonorogoPageModule(pageId));
  const Component = module.default;
  return <Component />;
});
const ponorogoLazyPage = (pageId: string): React.ComponentType => () => <PonorogoLazyPage pageId={pageId} />;

const LoginServer = ponorogoLazyPage('tabBeranda');
const PonorogoPresensiPageLazy = ponorogoLazyPage('tabAbsen');
const LogPresensi = ponorogoLazyPage('tabLog');
const Produktivitas = ponorogoLazyPage('tabInputAktivitas');
const LogProduktivitas = ponorogoLazyPage('tabAktivitas');
const Izin = ponorogoLazyPage('tabIzin');
const LogPresensiInstansi = ponorogoLazyPage('tabLogPresensiInstansi');
const ReviewProduktivitas = ponorogoLazyPage('tabReview');
const Database = ponorogoLazyPage('tabDatabase');
const Unor = ponorogoLazyPage('tabUnor');
const PonorogoLaporanPageLazy = ponorogoLazyPage('tabReport');
const Automasi = AUTOMATION_AVAILABLE ? ponorogoLazyPage('tabAutomasi') : null;

type PonorogoPageGroup = 'utama' | 'referensi' | 'akun';
interface PonorogoPageDefinition { id: string; icon: LucideIcon; label: string; component: React.ComponentType; group: PonorogoPageGroup; }

const PONOROGO_PAGES: PonorogoPageDefinition[] = [
  { id: 'tabBeranda', icon: Home, label: 'Beranda', component: LoginServer, group: 'utama' },
  { id: 'tabAbsen', icon: Camera, label: 'Submit Presensi', component: PonorogoPresensiPageLazy, group: 'utama' },
  { id: 'tabLog', icon: FileText, label: 'History Presensi', component: LogPresensi, group: 'utama' },
  { id: 'tabInputAktivitas', icon: Edit3, label: 'Produktivitas Harian', component: Produktivitas, group: 'utama' },
  { id: 'tabAktivitas', icon: Activity, label: 'History Produktivitas', component: LogProduktivitas, group: 'utama' },
  { id: 'tabReview', icon: BarChart3, label: 'Review Produktivitas', component: ReviewProduktivitas, group: 'utama' },
  { id: 'tabIzin', icon: FileCheck, label: 'Izin/Cuti', component: Izin, group: 'utama' },
  { id: 'tabLogPresensiInstansi', icon: Building2, label: 'History Presensi Instansi', component: LogPresensiInstansi, group: 'utama' },
  { id: 'tabReport', icon: FileText, label: 'Laporan', component: PonorogoLaporanPageLazy, group: 'utama' },
  ...(AUTOMATION_AVAILABLE && Automasi ? [{ id: 'tabAutomasi', icon: Bot, label: 'Preset Automasi', component: Automasi, group: 'referensi' } as PonorogoPageDefinition] : []),
  { id: 'tabDatabase', icon: DatabaseIcon, label: 'Database Pegawai', component: Database, group: 'referensi' },
  { id: 'tabUnor', icon: Network, label: 'Struktur Organisasi', component: Unor, group: 'referensi' },
];

const PONOROGO_GROUP_LABELS: Record<PonorogoPageGroup, string> = { utama: 'Menu Utama', referensi: 'Referensi', akun: 'Akun & Server' };
const PONOROGO_GROUP_ORDER: PonorogoPageGroup[] = ['utama', 'referensi'];

function PonorogoPageFallback() { return <PageFallback />; }

function PonorogoShell({ onLogout, isDarkMode, toggleDarkMode, devInspectorOpen, onToggleInspector, routePageSlug }: { onLogout: () => void; isDarkMode: boolean; toggleDarkMode: () => void; devInspectorOpen: boolean; onToggleInspector: () => void; routePageSlug?: string | null; }) {
  const { pegawai, activePage, setActivePage } = usePonorogoAppContext();
  const serverStatus = usePresensiServerOnline();
  const lastAppliedRouteSlug = React.useRef<string | null | undefined>(undefined);
  const appSession = loadAppAuthSession();
  const [ubahPasswordOpen, setUbahPasswordOpen] = useState(false);
  const allowedPonorogoPages = useMemo(() => PONOROGO_PAGES.filter(p => isMenuAllowed(appSession?.permissions as any, 'ponorogo', p.id, (appSession?.role as any) || 'user')), [appSession]);

  // Sinkronkan hanya saat slug URL berubah dari luar (refresh/deep-link/popstate), bukan saat klik menu internal.
  React.useEffect(() => {
    if (routePageSlug === lastAppliedRouteSlug.current) return;
    lastAppliedRouteSlug.current = routePageSlug;
    if (!routePageSlug) return;
    const pid = slugToPageId('ponorogo', 'ponorogo-absensi', routePageSlug);
    if (pid && pid !== activePage) setActivePage(pid);
  }, [routePageSlug, activePage, setActivePage]);

  React.useEffect(() => {
    // Hindari menimpa URL deep-link saat sinkronisasi awal dari route slug
    if (routePageSlug) {
      const expectedPid = slugToPageId('ponorogo', 'ponorogo-absensi', routePageSlug);
      if (expectedPid && expectedPid !== activePage) return;
    }
    const path = pageToPath('ponorogo', 'ponorogo-absensi', activePage);
    if (window.location.pathname !== path) navigateTo(path, true);
  }, [activePage, routePageSlug]);
  useEffect(() => {
    const allowed = allowedPonorogoPages.some(p => p.id === activePage);
    if (!allowed) {
      const fallback = allowedPonorogoPages[0]?.id || 'tabBeranda';
      if (fallback !== activePage) setActivePage(fallback);
    }
  }, [activePage, allowedPonorogoPages, setActivePage]);

  const page = useMemo(() => allowedPonorogoPages.find(p => p.id === activePage) || allowedPonorogoPages[0] || PONOROGO_PAGES[0], [activePage, allowedPonorogoPages]);
  const Page = page.component;
  const groups = useMemo(() => PONOROGO_GROUP_ORDER.map(g => ({
    id: g,
    label: PONOROGO_GROUP_LABELS[g],
    pages: allowedPonorogoPages.filter(p => p.group === g).map(p => ({ id: p.id, label: p.label, icon: p.icon })),
  })).filter(g => g.pages.length), [allowedPonorogoPages]);

  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false);
  const requestLogout = () => setConfirmLogoutOpen(true);
  const doLogout = async () => {
    setConfirmLogoutOpen(false);
    await Promise.resolve(onLogout());
  };

  const displayName = (pegawai as any)?.nama || (pegawai as any)?.nip || 'Pengguna';
  const nip = (pegawai as any)?.nip || '';
  const rawPhoto = (pegawai as any)?.profilePic || (pegawai as any)?.foto || '';
  const accountPhotoUrl = rawPhoto
    ? (rawPhoto.startsWith('data:') || rawPhoto.startsWith('blob:')
        ? rawPhoto
        : rawPhoto.startsWith('http://') || rawPhoto.startsWith('https://')
          ? apiUrl(`/api/proxy-image?path=${encodeURIComponent(rawPhoto)}`)
          : apiUrl(`/api/proxy-image?path=${encodeURIComponent(rawPhoto.startsWith('/') ? rawPhoto : `/${rawPhoto}`)}`))
    : null;

  return (
    <>
      <AppShellLayout
        brandTitle="Ponorogo"
        brandSubtitle="Presensi Ponorogo"
        groups={groups}
        activePageId={page.id}
        onSelectPage={setActivePage}
        onLogout={requestLogout}
        isDarkMode={isDarkMode}
        toggleDarkMode={toggleDarkMode}
        headerTitle={page.label}
        headerSubtitle={`${displayName}${nip ? ` · ${nip}` : ''}`}
        collapsible
        footer={AUTOMATION_AVAILABLE ? <GlobalPresetScheduler /> : undefined}
        statusLabel={serverStatus === 'online' ? 'Online' : 'Offline'}
        statusTone={serverStatus === 'online' ? 'emerald' : 'amber'}
        showSidebarAccount={false}
        rightPanel={<DeveloperInspector enabled={devInspectorOpen} onClose={onToggleInspector} />}
        account={{
          displayName,
          photoUrl: accountPhotoUrl,
          roleLabel: 'Ponorogo',
          subtitle: nip || 'Pegawai',
          items: [
            {
              id: 'ubah-password-mobile',
              label: 'Ubah Password Mobile',
              hint: 'Ubah password akun presensi mobile',
              icon: <KeyRound className="w-4 h-4 text-blue-500" />,
              onClick: () => setUbahPasswordOpen(true),
            },
            {
              id: 'dev-inspector',
              label: 'Developer Inspector',
              hint: devInspectorOpen ? 'Panel dev aktif (buka/tutup)' : 'Buka panel network/API inspector',
              icon: <Code2 className="w-4 h-4 text-sky-500" />,
              onClick: onToggleInspector,
            },
            {
              id: 'logout-server',
              label: 'Keluar / Ganti Server',
              hint: 'Kembali ke pilihan server',
              icon: <LogOut className="w-4 h-4 text-rose-500" />,
              tone: 'danger',
              onClick: requestLogout,
            },
          ],
        }}
      >
        <Suspense fallback={<PonorogoPageFallback />}>
          <Page />
        </Suspense>
      </AppShellLayout>
      <PonorogoUbahPasswordModal open={ubahPasswordOpen} onClose={() => setUbahPasswordOpen(false)} />
      <ConfirmLogoutModal open={confirmLogoutOpen} onCancel={() => setConfirmLogoutOpen(false)} onConfirm={doLogout} />
    </>
  );
}

function PonorogoApp({ onLogout, devInspectorOpen, onToggleInspector, routePageSlug }: { onLogout: () => void; devInspectorOpen: boolean; onToggleInspector: () => void; routePageSlug?: string | null }) {
  const { isDarkMode, toggleDarkMode } = useDarkMode();
  return (
    <PonorogoAppProvider>
      <PonorogoShell onLogout={onLogout} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} devInspectorOpen={devInspectorOpen} onToggleInspector={onToggleInspector} routePageSlug={routePageSlug} />
    </PonorogoAppProvider>
  );
}

function AppRouter({ isDarkMode, toggleDarkMode }: { isDarkMode: boolean; toggleDarkMode: () => void }) {
  const { pegawai, serverProfile, logout, loginForm } = useAppContext();
  const [devInspectorOpen, setDevInspectorOpen] = useState(false);
  const [appAuthed, setAppAuthed] = useState<boolean>(() => !!loadAppAuthSession());
  const [routeSlug, setRouteSlug] = useState<string | null>(() => {
    const r = pathToRoute(window.location.pathname);
    return r.kind === 'app' ? (r.pageId || null) : null;
  });

  const handleAppLogin = useCallback(() => {
    setAppAuthed(!!loadAppAuthSession());
    navigateTo('/login', true);
  }, []);

  const handleAppLogout = useCallback(() => {
    try { clearAppAuthSession(); } catch {}
    try { logout(); } catch {}
    setAppAuthed(false);
    navigateTo('/masuk', true);
  }, [logout]);

  useEffect(() => {
    const syncRoute = () => {
      const r = pathToRoute(window.location.pathname);
      if (r.kind === 'app') setRouteSlug(r.pageId || null);
      else setRouteSlug(null);
      // resync auth state (in case session expired/cleared)
      const ok = !!loadAppAuthSession();
      if (ok !== appAuthed) setAppAuthed(ok);
    };
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, [appAuthed]);

  // touch session on activity (web) & periodic expiry check
  useEffect(() => {
    if (!appAuthed) return;
    const touch = () => { try { touchAppAuthSession(); } catch {} };
    const check = () => { if (!loadAppAuthSession()) { setAppAuthed(false); navigateTo('/masuk', true); } };
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(e => window.addEventListener(e, touch));
    const iv = setInterval(check, 15000);
    return () => { events.forEach(e => window.removeEventListener(e, touch)); clearInterval(iv); };
  }, [appAuthed]);

  // routing guard: /masuk <-> /login <-> /<profile>/*
  useEffect(() => {
    const pathname = window.location.pathname;
    const r = pathToRoute(pathname);

    if (!appAuthed) {
      if (pathname !== '/masuk') navigateTo('/masuk', true);
      if (routeSlug !== null) setRouteSlug(null);
      return;
    }

    if (!pegawai) {
      if (pathname !== '/login') navigateTo('/login', true);
      if (routeSlug !== null) setRouteSlug(null);
      return;
    }

    if (r.kind !== 'app' || r.profileId !== serverProfile.id) {
      const keepSlug = r.kind === 'app' && r.profileId === serverProfile.id ? r.pageId : null;
      const keepPageId = keepSlug ? slugToPageId(serverProfile.id, serverProfile.mode, keepSlug) : null;
      const path = pageToPath(serverProfile.id, serverProfile.mode, keepPageId || defaultPageForProfile(serverProfile.id, serverProfile.mode));
      if (pathname !== path) navigateTo(path, true);
      const nr = pathToRoute(path);
      const nextSlug = nr.kind === 'app' ? (nr.pageId || null) : null;
      if (routeSlug !== nextSlug) setRouteSlug(nextSlug);
      return;
    }

    if (r.pageId !== routeSlug) setRouteSlug(r.pageId || null);
  }, [appAuthed, pegawai, serverProfile.id, serverProfile.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!appAuthed) {
    return <AppLoginScreen onLogin={handleAppLogin} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />;
  }

  if (!pegawai) {
    return (
      <ServerHub
        isDarkMode={isDarkMode}
        toggleDarkMode={toggleDarkMode}
        onAppLogout={handleAppLogout}
      />
    );
  }

  // Cegah akses profil server yang tidak diizinkan untuk role user
  const appSession = loadAppAuthSession();
  if (appSession && appSession.role !== 'admin' && !isProfileAllowed(appSession.permissions, serverProfile.id, appSession.role)) {
    // logout sesi presensi profil terlarang dan kembali ke pilihan server
    try { logout(); } catch {}
    navigateTo('/login', true);
    return <ServerHub isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} onAppLogout={handleAppLogout} />;
  }

  if (serverProfile.mode === 'ponorogo-absensi') {
    const handleLogout = async () => {
      try { tandaiKeluarServer(loginForm.username || (pegawai as any).nip || '', serverProfile.id); } catch {}
      logout();
      navigateTo('/login', true);
    };
    return (
      <PonorogoApp
        onLogout={handleLogout}
        devInspectorOpen={devInspectorOpen}
        onToggleInspector={() => setDevInspectorOpen(v => !v)}
        routePageSlug={routeSlug}
      />
    );
  }

  return (
    <BkdShell
      isDarkMode={isDarkMode}
      toggleDarkMode={toggleDarkMode}
      devInspectorOpen={devInspectorOpen}
      onToggleInspector={() => setDevInspectorOpen(v => !v)}
      routePageSlug={routeSlug}
    />
  );
}


class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; message: string }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, message: String(error?.message || error || 'Terjadi kesalahan.') };
  }
  componentDidCatch(error: any) {
    console.error('[AppErrorBoundary]', error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-100">
          <div className="max-w-md w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="text-base font-bold">Aplikasi mengalami kendala</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 break-words">{this.state.message}</div>
            <div className="flex gap-2">
              <button onClick={() => window.location.reload()} className="px-3 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold">Muat Ulang</button>
              <button onClick={() => { try { localStorage.removeItem('presensi_local_session_v1'); sessionStorage.clear(); } catch {} window.location.href = window.location.pathname + '?reset=1'; }} className="px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-sm font-semibold">Reset &amp; Ke Login</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children as any;
  }
}

export default function App() {
  const { isDarkMode, toggleDarkMode } = useDarkMode();
  return (
    <AppErrorBoundary>
      <AppProvider>
        <ToastProvider>
          <AppRouter isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />
        </ToastProvider>
      </AppProvider>
    </AppErrorBoundary>
  );
}
