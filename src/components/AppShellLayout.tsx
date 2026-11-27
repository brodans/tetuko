import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Menu, Moon, Sun, X, LogOut, ChevronLeft, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { APP_LOGO } from '../lib/appIdentity';
import AkunDropdown, { type AkunDropdownItem } from './ui/AkunDropdown';

export interface ShellPage {
  id: string;
  label: string;
  icon: LucideIcon;
  group?: string;
}

export interface ShellGroup {
  id: string;
  label: string;
  pages: ShellPage[];
}

export interface ShellAccount {
  displayName: string;
  photoUrl?: string | null;
  roleLabel?: string;
  subtitle?: string;
  items?: AkunDropdownItem[];
}

interface AppShellLayoutProps {
  brandTitle: string;
  brandSubtitle?: string;
  pages?: ShellPage[];
  groups?: ShellGroup[];
  activePageId: string;
  onSelectPage: (id: string) => void;
  onLogout: () => void;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  headerTitle: string;
  headerSubtitle?: string;
  children: ReactNode;
  collapsible?: boolean;
  footer?: ReactNode;
  account?: ShellAccount;
  statusLabel?: string;
  statusTone?: 'emerald' | 'amber' | 'slate';
  showSidebarAccount?: boolean;
  rightPanel?: ReactNode;
}

export default function AppShellLayout({
  brandTitle,
  brandSubtitle,
  pages,
  groups,
  activePageId,
  onSelectPage,
  onLogout,
  isDarkMode,
  toggleDarkMode,
  headerTitle,
  headerSubtitle,
  children,
  collapsible = true,
  footer,
  account,
  statusLabel,
  statusTone = 'slate',
  showSidebarAccount = true,
  rightPanel,
}: AppShellLayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);

  const isExpanded = isSidebarExpanded || isMobileMenuOpen;

  const navItems = (list: ShellPage[]) =>
    list.map((p) => {
      const Icon = p.icon;
      const isActive = p.id === activePageId;
      return (
        <button
          key={p.id}
          onClick={() => {
            onSelectPage(p.id);
            setIsMobileMenuOpen(false);
          }}
          className={`w-full h-10 relative flex items-center rounded-md text-left font-medium transition-all duration-200 group px-3 ${
            isActive ? 'bg-blue-600/10 text-blue-400' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
          }`}
          title={!isExpanded ? p.label : undefined}
        >
          {isActive && (
            <motion.div layoutId="activeNav" className="absolute left-0 top-1.5 bottom-1.5 w-1 bg-blue-500 rounded-r" />
          )}
          <Icon className={`w-5 h-5 shrink-0 transition-colors ${isActive ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'}`} />
          <span className={`truncate text-sm transition-[max-width,opacity,margin] duration-300 ${isExpanded ? 'ml-3 max-w-[180px] opacity-100' : 'ml-0 max-w-0 opacity-0'}`}>
            {p.label}
          </span>
        </button>
      );
    });

  const statusStyles = {
    emerald: 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    amber: 'border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400',
    slate: 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300',
  }[statusTone];

  const accountItems: AkunDropdownItem[] = (account?.items && account.items.length > 0)
    ? account.items
    : [{ id: 'logout', label: 'Keluar / Ganti Server', hint: 'Kembali ke pilihan server', icon: <LogOut className="w-4 h-4 text-rose-500" />, tone: 'danger', onClick: onLogout }];

  return (
    <div className="poni-workspace bg-slate-50 dark:bg-[#0B1120] text-slate-800 dark:text-slate-200 font-sans h-[100svh] w-full flex transition-colors duration-300 overflow-hidden relative">
      {/* Sidebar */}
      <aside
        className={`poni-sidebar bg-[#0F172A] dark:bg-[#070B14] border-r border-slate-800/50 flex flex-col h-full fixed inset-y-0 left-0 lg:relative lg:inset-y-auto lg:left-auto transition-all duration-300 ease-in-out z-40 shadow-2xl lg:shadow-none ${
          isSidebarExpanded ? 'w-64' : 'w-[84px]'
        } ${isMobileMenuOpen ? 'translate-x-0 w-64' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* Header */}
        <div className="h-[56px] flex items-center px-4 border-b border-slate-800/60 justify-between shrink-0">
          <div className="flex items-center gap-3 overflow-hidden min-w-0">
            <div className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-md bg-slate-700/80 p-1">
              <img src={APP_LOGO} alt={brandTitle} className="w-full h-full object-contain" />
            </div>
            <div className={`min-w-0 overflow-hidden transition-[max-width,opacity] duration-300 ${isExpanded ? 'max-w-[150px] opacity-100' : 'max-w-0 opacity-0'}`}>
              <div className="font-bold text-sm tracking-tight text-white truncate">{brandTitle}</div>
              {brandSubtitle && <div className="text-[10px] text-slate-400 truncate">{brandSubtitle}</div>}
            </div>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="lg:hidden text-slate-400 hover:text-white flex-shrink-0 transition-colors p-1.5 rounded hover:bg-slate-800"
            aria-label="Tutup menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Floating toggle (desktop) */}
        {collapsible && (
          <button
            onClick={() => setIsSidebarExpanded((v) => !v)}
            className="hidden lg:flex absolute top-[84px] -right-3.5 w-7 h-7 bg-[#1E293B] dark:bg-[#0F172A] border border-slate-700/80 rounded-full items-center justify-center text-slate-400 hover:text-white shadow-lg transition-transform hover:scale-110 z-50 focus:outline-none"
            aria-label={isSidebarExpanded ? 'Ciutkan menu' : 'Perluas menu'}
            title={isSidebarExpanded ? 'Ciutkan menu' : 'Perluas menu'}
          >
            {isSidebarExpanded ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        )}

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-5 px-3.5 space-y-5 custom-scrollbar">
          {groups && groups.length > 0 ? (
            groups.map((g) => (
              <div key={g.id} className="space-y-1.5">
                {g.label && (
                  <p className={`px-3.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 transition-opacity duration-300 ${isExpanded ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden'}`}>
                    {g.label}
                  </p>
                )}
                {navItems(g.pages)}
              </div>
            ))
          ) : (
            <div className="space-y-1.5">{navItems(pages || [])}</div>
          )}
        </nav>

        {/* Footer */}
        <div className="mt-auto p-3 border-t border-slate-800/60 space-y-2 bg-gradient-to-b from-transparent to-slate-900/40 shrink-0">
          {account && showSidebarAccount && (
            <div className="min-h-[50px] overflow-hidden rounded-md border border-slate-700/50 bg-[#1E293B]/50 p-2.5" title={account.displayName}>
              <div className={`flex min-w-0 items-center transition-[gap] duration-300 ${isExpanded ? 'gap-2.5' : 'justify-center gap-0'}`}>
                <div className="w-8 h-8 rounded-md bg-blue-500/20 text-blue-300 border border-blue-400/20 flex items-center justify-center text-xs font-bold shrink-0 overflow-hidden">
                  {account.photoUrl ? <img src={account.photoUrl} alt="" className="w-full h-full object-cover" /> : (account.displayName || '?').slice(0, 1).toUpperCase()}
                </div>
                <div className={`min-w-0 overflow-hidden transition-[max-width,opacity] duration-300 ${isExpanded ? 'max-w-[140px] flex-1 opacity-100' : 'max-w-0 opacity-0'}`}>
                  <p className="truncate text-xs font-semibold text-slate-200">{account.displayName}</p>
                  <p className="truncate text-[10px] text-slate-400">{account.subtitle || account.roleLabel || ''}</p>
                </div>
              </div>
            </div>
          )}
          <button
            onClick={onLogout}
            className="w-full h-10 flex items-center rounded-md text-left font-medium transition-all duration-200 group text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 px-3"
            title={!isExpanded ? 'Keluar / Ganti Server' : undefined}
          >
            <LogOut className="w-5 h-5 shrink-0" />
            <span className={`truncate text-sm transition-[max-width,opacity,margin] duration-300 ${isExpanded ? 'ml-3 max-w-[140px] opacity-100' : 'ml-0 max-w-0 opacity-0'}`}>
              Keluar / Ganti
            </span>
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/70 z-30 lg:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Main */}
      <div className={`flex-1 flex flex-col min-w-0 h-full min-h-0 relative ${isMobileMenuOpen ? 'pointer-events-none lg:pointer-events-auto' : ''}`}>
        <header className="poni-header h-[56px] bg-white/90 dark:bg-[#0B1120]/90 border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between gap-3 transition-colors duration-300 shrink-0 z-30 px-4 sm:px-6 relative">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors active:scale-95 shrink-0"
              aria-label="Buka menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex flex-col min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-100 truncate tracking-tight">{headerTitle}</h2>
              {headerSubtitle && <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{headerSubtitle}</p>}
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {statusLabel && (
              <span className={`hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[10px] font-bold uppercase tracking-wider ${statusStyles}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${statusTone === 'emerald' ? 'bg-emerald-500' : statusTone === 'amber' ? 'bg-amber-500' : 'bg-slate-400'}`} />
                {statusLabel}
              </span>
            )}

            {account && (
              <AkunDropdown
                displayName={account.displayName}
                photoUrl={account.photoUrl || undefined}
                roleLabel={account.roleLabel}
                subtitle={account.subtitle}
                items={accountItems}
              />
            )}

            <button
              onClick={toggleDarkMode}
              className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors focus:outline-none shrink-0"
              aria-label="Ganti tema"
            >
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </header>

        <div className="konten-gulir flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto custom-scrollbar relative">
          <main className="poni-konten min-h-full flex-none min-w-0 overflow-x-hidden w-full">
            {children}
          </main>
        </div>
      </div>

      {rightPanel}
      {footer}
    </div>
  );
}
