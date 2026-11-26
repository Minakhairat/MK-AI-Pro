import React from 'react';
import { ArrowLeft, ArrowRight, Bell, Laptop, Plus, WifiOff } from 'lucide-react';
import { useI18n } from '../../contexts/I18nContext';
import { useNotifications } from '../../contexts/NotificationContext';

interface MobileTopBarProps {
  title: string;
  subtitle?: string;
  isOnline: boolean;
  showBack?: boolean;
  onBack?: () => void;
  onCreateProject: () => void;
  onOpenNotifications: () => void;
  onSwitchToDesktopLayout: () => void;
}

export function MobileTopBar({
  title,
  subtitle,
  isOnline,
  showBack,
  onBack,
  onCreateProject,
  onOpenNotifications,
  onSwitchToDesktopLayout,
}: MobileTopBarProps) {
  const { locale, dir } = useI18n();
  const { unreadCount } = useNotifications();
  const BackIcon = dir === 'rtl' ? ArrowRight : ArrowLeft;

  return (
    <header className="sticky top-0 z-30 h-12 px-3 border-b border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 backdrop-blur flex items-center justify-between gap-2 pt-[env(safe-area-inset-top)]">
      <div className="flex items-center gap-2 min-w-0">
        {showBack && onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label={locale === 'ar' ? 'رجوع' : 'Back'}
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900 shrink-0"
          >
            <BackIcon className="w-5 h-5" />
          </button>
        ) : (
          <div className="w-8 h-8 rounded-md bg-red-600 text-white font-display font-bold text-xs flex items-center justify-center shrink-0">
            MK
          </div>
        )}

        <div className="min-w-0">
          <div className="text-sm font-display font-bold text-zinc-900 dark:text-zinc-100 truncate">
            {title}
          </div>
          {subtitle && (
            <div className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 truncate">
              {subtitle}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {!isOnline && (
          <span
            title={locale === 'ar' ? 'وضع عدم الاتصال' : 'Offline Mode'}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 text-[10px] font-mono font-semibold"
          >
            <WifiOff className="w-3 h-3" />
            <span>{locale === 'ar' ? 'أوفلاين' : 'Offline'}</span>
          </span>
        )}

        <button
          type="button"
          onClick={onCreateProject}
          aria-label={locale === 'ar' ? 'مشروع جديد' : 'New Project'}
          className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-red-600 dark:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
        >
          <Plus className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={onOpenNotifications}
          aria-label={locale === 'ar' ? 'الإشعارات' : 'Notifications'}
          className="relative min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute top-2 end-2 min-w-[16px] h-4 px-1 rounded-sm bg-red-600 text-white text-[10px] font-mono font-bold flex items-center justify-center tabular-nums">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={onSwitchToDesktopLayout}
          title={locale === 'ar' ? 'عرض سطح المكتب الكامل' : 'Full Desktop Layout'}
          aria-label={locale === 'ar' ? 'عرض سطح المكتب الكامل' : 'Full Desktop Layout'}
          className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          <Laptop className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
