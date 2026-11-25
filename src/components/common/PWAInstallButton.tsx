import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { useI18n } from '../../contexts/I18nContext';
import { usePWAInstall } from '../../hooks/usePWAInstall';

export function PWAInstallButton() {
  const { t } = useI18n();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition-colors whitespace-nowrap shrink-0"
      >
        <Download className="w-3.5 h-3.5" />
        <span>{t.pwa.installAppBtn}</span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuide(true)}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
      >
        <Smartphone className="w-3.5 h-3.5 text-red-600 dark:text-red-500" />
        <span>{isIOS ? t.pwa.installIosBtn : t.pwa.installGuideBtn}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100">
                {t.pwa.guideTitle}
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label={t.projectModal.cancel}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
              {isIOS ? t.pwa.iosInstructions : t.pwa.desktopInstructions}
            </p>
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full py-2 text-xs font-semibold rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 transition-opacity"
            >
              {t.pwa.closeGuide}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
