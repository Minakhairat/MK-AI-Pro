import React, { useState } from 'react';
import { Download, PlusSquare, Share, Smartphone, X } from 'lucide-react';
import { useI18n } from '../../contexts/I18nContext';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { isDesktopApp } from '../../lib/desktopClient';

export function PWAInstallButton() {
  const { t, locale } = useI18n();
  const { isInstallable, isInstalled, isIOS, isAndroid, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled || isDesktopApp()) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="w-full min-h-[44px] flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition-colors whitespace-nowrap shrink-0"
      >
        <Download className="w-4 h-4" />
        <span>{t.pwa.installAppBtn}</span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuide(true)}
        className="w-full min-h-[44px] flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
      >
        <Smartphone className="w-4 h-4 text-red-600 dark:text-red-500" />
        <span>{isIOS ? t.pwa.installIosBtn : t.pwa.installGuideBtn}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] space-y-4 shadow-xl">
            <div className="w-10 h-1.5 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-auto sm:hidden" />
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100">
                {t.pwa.guideTitle}
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label={t.common.close}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <div className="space-y-3 text-xs text-zinc-600 dark:text-zinc-300">
                <p className="leading-relaxed">{t.pwa.iosInstructions}</p>
                <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-2">
                  <div className="flex items-center gap-2.5">
                    <Share className="w-4 h-4 text-red-600 shrink-0" />
                    <span>
                      {locale === 'ar'
                        ? '1. افتح القائمة Share في أسفل متصفح Safari'
                        : '1. Tap the Share button in Safari bottom toolbar'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <PlusSquare className="w-4 h-4 text-red-600 shrink-0" />
                    <span>
                      {locale === 'ar'
                        ? '2. اختر "إضافة إلى الشاشة الرئيسية" ثم اضغط إضافة'
                        : '2. Scroll down and tap "Add to Home Screen", then Add'}
                    </span>
                  </div>
                </div>
              </div>
            ) : isAndroid ? (
              <div className="space-y-2 text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
                <p>
                  {locale === 'ar'
                    ? 'في متصفح Chrome على أندرويد، افتح قائمة المتصفح (⋮) واختر "تثبيت التطبيق" أو "إضافة إلى الشاشة الرئيسية" لتشغيل MK AI كتطبيق مستقل.'
                    : 'In Android Chrome, open the browser menu (⋮) and tap "Install app" or "Add to Home screen" to run MK AI as a standalone mobile app.'}
                </p>
              </div>
            ) : (
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                {t.pwa.desktopInstructions}
              </p>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full min-h-[44px] py-2.5 text-xs font-semibold rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 transition-opacity"
            >
              {t.pwa.closeGuide}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
