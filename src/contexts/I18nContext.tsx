import React, { createContext, useContext, useEffect, useState } from 'react';
import { translations, type TranslationDictionary } from '../i18n/translations';
import type { Locale } from '../types/domain';

interface I18nContextValue {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  t: TranslationDictionary;
  setLocale: (loc: Locale) => void;
  toggleLocale: () => void;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

const STORAGE_KEY = 'mk_ai_locale';

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === 'ar' || saved === 'en') return saved;
    } catch {
      // Ignore storage errors
    }
    return 'en';
  });

  const dir: 'ltr' | 'rtl' = locale === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Ignore storage errors
    }
  }, [locale, dir]);

  const setLocale = (loc: Locale) => setLocaleState(loc);
  const toggleLocale = () => setLocaleState((prev) => (prev === 'en' ? 'ar' : 'en'));

  return (
    <I18nContext.Provider
      value={{ locale, dir, t: translations[locale], setLocale, toggleLocale }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
