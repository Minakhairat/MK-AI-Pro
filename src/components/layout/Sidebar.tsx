import React from 'react';
import {
  Boxes,
  Cpu,
  FolderKanban,
  Globe,
  LayoutDashboard,
  LogOut,
  Moon,
  Network,
  Shield,
  Sun,
  X,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { useTheme } from '../../contexts/ThemeContext';
import { updateUserPreferences } from '../../services/firestoreService';
import type { AppSection } from '../../types/domain';
import { PWAInstallButton } from '../common/PWAInstallButton';

interface SidebarProps {
  activeSection: AppSection;
  onSelectSection: (section: AppSection) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  activeSection,
  onSelectSection,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const { user, profile, signOut } = useAuth();
  const { t, locale, toggleLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();

  const navItems: { id: AppSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'dashboard', label: t.nav.dashboard, icon: LayoutDashboard },
    { id: 'projects', label: t.nav.projects, icon: FolderKanban },
    { id: 'model_hub', label: t.nav.modelHub, icon: Cpu },
    { id: 'workspaces', label: t.nav.workspaces, icon: Boxes },
    { id: 'architecture', label: t.nav.architecture, icon: Network },
    { id: 'settings', label: t.nav.settings, icon: Shield },
  ];

  const handleToggleLocale = () => {
    const nextLocale = locale === 'en' ? 'ar' : 'en';
    toggleLocale();
    if (user) {
      void updateUserPreferences({ uid: user.uid, preferredLocale: nextLocale }).catch(() => {});
    }
  };

  const handleToggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    toggleTheme();
    if (user) {
      void updateUserPreferences({ uid: user.uid, preferredTheme: nextTheme }).catch(() => {});
    }
  };

  const content = (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-900 border-e border-zinc-200 dark:border-zinc-800 w-64 shrink-0">
      {/* Brand Header */}
      <div className="h-16 px-5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-3 whitespace-nowrap shrink-0">
          <div className="w-7 h-7 rounded-md bg-red-600 flex items-center justify-center text-white font-display font-bold text-xs">
            MK
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-display font-bold text-base tracking-tight text-zinc-900 dark:text-zinc-100">
              {t.brandName}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {t.brandCompany}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          className="lg:hidden p-1.5 rounded-md text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
          aria-label={t.common.close}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectSection(item.id);
                onCloseMobile();
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                active
                  ? 'bg-red-600 text-white'
                  : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-800'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Bottom Preferences & Account */}
      <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 space-y-2">
        <PWAInstallButton />
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleToggleLocale}
            className="flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap"
          >
            <Globe className="w-3.5 h-3.5 shrink-0" />
            <span>{t.topBar.languageLabel}</span>
          </button>
          <button
            type="button"
            onClick={handleToggleTheme}
            className="flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap"
          >
            {theme === 'dark' ? (
              <Sun className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <Moon className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>{theme === 'dark' ? t.topBar.lightMode : t.topBar.darkMode}</span>
          </button>
        </div>

        <div className="px-2.5 py-2 rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              {profile?.displayName || user?.displayName || 'MK Engineer'}
            </p>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
              {user?.email}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            title={t.nav.signOut}
            aria-label={t.nav.signOut}
            className="p-1.5 rounded-md text-zinc-500 hover:text-red-600 dark:hover:text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block shrink-0">{content}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{content}</div>
        </div>
      )}
    </>
  );
}
