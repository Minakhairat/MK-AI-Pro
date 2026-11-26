import React from 'react';
import { Box, Camera, Cpu, Home, MoreHorizontal } from 'lucide-react';
import { useI18n } from '../../contexts/I18nContext';

export type MobileTabId = 'home' | 'capture' | 'train' | 'models' | 'more';

interface MobileBottomNavProps {
  activeTab: MobileTabId;
  onSelectTab: (tab: MobileTabId) => void;
  queueBadge?: number;
}

export function MobileBottomNav({
  activeTab,
  onSelectTab,
  queueBadge = 0,
}: MobileBottomNavProps) {
  const { locale } = useI18n();

  const items: {
    id: MobileTabId;
    labelEn: string;
    labelAr: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: 'home', labelEn: 'Home', labelAr: 'الرئيسية', icon: Home },
    { id: 'capture', labelEn: 'Capture', labelAr: 'التقاط', icon: Camera },
    { id: 'train', labelEn: 'Train', labelAr: 'تدريب', icon: Cpu },
    { id: 'models', labelEn: 'Models', labelAr: 'النماذج', icon: Box },
    { id: 'more', labelEn: 'More', labelAr: 'المزيد', icon: MoreHorizontal },
  ];

  return (
    <nav
      aria-label={locale === 'ar' ? 'التنقل السفلي' : 'Mobile Navigation'}
      className="fixed bottom-0 inset-x-0 z-40 border-t border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
    >
      <div className="grid grid-cols-5 h-[58px] max-w-xl mx-auto">
        {items.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              aria-current={active ? 'page' : undefined}
              className={`relative min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors ${
                active
                  ? 'text-red-600 dark:text-red-500'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="truncate max-w-full px-1">
                {locale === 'ar' ? item.labelAr : item.labelEn}
              </span>
              {item.id === 'more' && queueBadge > 0 && (
                <span className="absolute top-1.5 end-3 min-w-[15px] h-[15px] px-1 rounded-sm bg-amber-600 text-white text-[9px] font-mono flex items-center justify-center tabular-nums">
                  {queueBadge}
                </span>
              )}
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute top-0 inset-x-4 h-0.5 bg-red-600 dark:bg-red-500 rounded-b"
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
