import React from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useI18n } from '../../contexts/I18nContext';

interface PwaUpdateBannerProps {
  updateAvailable: boolean;
  onApplyUpdate: () => void;
  onDismiss: () => void;
}

export function PwaUpdateBanner({
  updateAvailable,
  onApplyUpdate,
  onDismiss,
}: PwaUpdateBannerProps) {
  const { locale } = useI18n();
  if (!updateAvailable) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 lg:bottom-5 start-4 end-4 lg:start-auto lg:end-5 lg:w-96 z-50 rounded-2xl border border-red-300 dark:border-red-900/70 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md p-3.5 shadow-xl flex items-center justify-between gap-3"
    >
      <div className="min-w-0">
        <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
          {locale === 'ar' ? 'تحديث جديد متاح لتطبيق MK AI' : 'New MK AI app update ready'}
        </p>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {locale === 'ar'
            ? 'أعد التحميل الآن لتطبيق آخر التحسينات بأمان.'
            : 'Reload to activate the latest cached app version.'}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onApplyUpdate}
          className="min-h-[44px] px-3 py-2 rounded-xl bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-red-700"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>{locale === 'ar' ? 'تحديث' : 'Update'}</span>
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss update notice"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
