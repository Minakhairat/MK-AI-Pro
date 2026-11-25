import React from 'react';
import { ArrowLeft, ArrowRight, Menu, Plus } from 'lucide-react';
import { useI18n } from '../../contexts/I18nContext';

interface TopBarProps {
  breadcrumbs: string[];
  onOpenMobileMenu: () => void;
  onCreateProject: () => void;
  showBackButton?: boolean;
  onBack?: () => void;
}

export function TopBar({
  breadcrumbs,
  onOpenMobileMenu,
  onCreateProject,
  showBackButton,
  onBack,
}: TopBarProps) {
  const { t, dir } = useI18n();
  const BackIcon = dir === 'rtl' ? ArrowRight : ArrowLeft;

  return (
    <header className="h-16 px-4 sm:px-6 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 flex items-center justify-between gap-6 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 shrink-0"
          aria-label="Open menu"
        >
          <Menu className="w-4 h-4" />
        </button>

        {showBackButton && onBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 whitespace-nowrap shrink-0"
          >
            <BackIcon className="w-3.5 h-3.5" />
            <span>{t.topBar.backToProjects}</span>
          </button>
        )}

        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm min-w-0">
          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            return (
              <React.Fragment key={`${crumb}-${idx}`}>
                {idx > 0 && (
                  <span className="text-zinc-400 dark:text-zinc-600 shrink-0" aria-hidden="true">
                    /
                  </span>
                )}
                <span
                  className={`truncate ${
                    isLast
                      ? 'font-semibold text-zinc-900 dark:text-zinc-100'
                      : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  {crumb}
                </span>
              </React.Fragment>
            );
          })}
        </nav>
      </div>

      <button
        type="button"
        onClick={onCreateProject}
        className="inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors whitespace-nowrap shrink-0"
      >
        <Plus className="w-4 h-4" />
        <span>{t.topBar.newProject}</span>
      </button>
    </header>
  );
}
