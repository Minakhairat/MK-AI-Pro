import React, { useState } from 'react';
import { Eye, Globe, Lock, Mail, Moon, ShieldCheck, Sun } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { useTheme } from '../../contexts/ThemeContext';

const HERO_OPTICS_IMAGE = '/src/assets/images/mk_vision_optics_1795607022083.jpg';

export function AuthScreen() {
  const {
    user,
    authError,
    clearAuthError,
    signInWithGoogle,
    signInWithEmail,
    registerWithEmail,
    requestPasswordReset,
    resendVerificationEmail,
    signOut,
  } = useAuth();
  const { t, locale, toggleLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  const handleGoogle = async () => {
    setBusy(true);
    setStatusMessage(null);
    try {
      await signInWithGoogle();
    } catch {
      // Error surfaced via authError
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatusMessage(null);
    clearAuthError();
    try {
      if (mode === 'login') {
        await signInWithEmail(email, password);
      } else {
        await registerWithEmail(name, email, password);
        setStatusMessage(t.auth.verificationSent);
      }
    } catch {
      // Error surfaced via authError
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setStatusMessage(null);
    try {
      await requestPasswordReset(email);
      setStatusMessage(t.auth.resetSent);
    } catch {
      // Error surfaced via authError
    } finally {
      setBusy(false);
    }
  };

  const needsEmailVerification = Boolean(user && !user.emailVerified);

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex flex-col">
      {/* Minimal Top Utility Strip */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-3 whitespace-nowrap shrink-0">
          <div className="w-7 h-7 rounded-md bg-red-600 flex items-center justify-center text-white font-display font-bold text-sm">
            MK
          </div>
          <span className="font-display font-bold text-base tracking-tight">
            {t.brandName}
          </span>
          <span className="text-zinc-400 dark:text-zinc-600" aria-hidden="true">
            ·
          </span>
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {t.brandCompany}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={toggleLocale}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors whitespace-nowrap"
          >
            <Globe className="w-3.5 h-3.5" />
            <span>{locale === 'en' ? 'العربية' : 'English'}</span>
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t.topBar.lightMode : t.topBar.darkMode}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors whitespace-nowrap"
          >
            {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            <span>{theme === 'dark' ? t.topBar.lightMode : t.topBar.darkMode}</span>
          </button>
        </div>
      </header>

      {/* Main 2-Column Split */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-2 items-stretch">
        {/* Visual Lab Panel */}
        <section className="relative hidden lg:flex flex-col justify-end overflow-hidden bg-zinc-900 border-e border-zinc-200 dark:border-zinc-800">
          {!imgFailed ? (
            <img
              src={HERO_OPTICS_IMAGE}
              alt="MK AI optical computer vision camera rig"
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 via-zinc-950 to-red-950 flex items-center justify-center">
              <Eye className="w-20 h-20 text-red-600/60" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-black/15" />

          <div className="relative z-10 p-12 max-w-xl text-white">
            <p className="text-xs font-semibold tracking-wider text-red-400 mb-3">
              {t.brandCompany}
            </p>
            <h1 className="text-3xl font-display font-bold leading-tight mb-4">
              {t.auth.title}
            </h1>
            <p className="text-sm text-zinc-200 leading-relaxed mb-8">
              {t.auth.subtitle}
            </p>
            <div className="space-y-3 text-sm text-zinc-300 border-t border-white/15 pt-6">
              <p>{t.auth.featureLine1}</p>
              <p>{t.auth.featureLine2}</p>
              <p>{t.auth.featureLine3}</p>
            </div>
          </div>
        </section>

        {/* Auth Form Panel */}
        <section className="flex items-center justify-center p-6 sm:p-12">
          <div className="w-full max-w-md space-y-6">
            <div>
              <h2 className="text-2xl font-display font-bold text-zinc-900 dark:text-zinc-100">
                {mode === 'login' ? t.auth.signInEmail : t.auth.createAccount}
              </h2>
              <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
                {t.auth.subtitle}
              </p>
            </div>

            {needsEmailVerification ? (
              <div className="border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 rounded-xl p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-900 dark:text-amber-200 leading-relaxed">
                    {t.auth.verifyEmailNotice}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      await resendVerificationEmail();
                      setStatusMessage(t.auth.verificationSent);
                      setBusy(false);
                    }}
                    className="px-4 py-2 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
                  >
                    {t.auth.resendVerification}
                  </button>
                  <button
                    type="button"
                    onClick={() => void signOut()}
                    className="px-4 py-2 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    {t.nav.signOut}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleGoogle}
                  className="w-full flex items-center justify-center gap-3 px-4 py-3 text-sm font-semibold rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-60"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z"
                    />
                  </svg>
                  <span>{busy ? t.auth.signingIn : t.auth.googleCta}</span>
                </button>

                <div className="relative flex items-center py-1">
                  <div className="flex-grow border-t border-zinc-200 dark:border-zinc-800" />
                  <span className="shrink-0 mx-3 text-xs text-zinc-500 dark:text-zinc-400">
                    {t.auth.dividerOr}
                  </span>
                  <div className="flex-grow border-t border-zinc-200 dark:border-zinc-800" />
                </div>

                <form onSubmit={handleEmailSubmit} className="space-y-4">
                  {mode === 'register' && (
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                        {t.auth.nameLabel}
                      </label>
                      <input
                        type="text"
                        required
                        minLength={2}
                        maxLength={120}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-600"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                      {t.auth.emailLabel}
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-zinc-400 absolute top-3 start-3.5 pointer-events-none" />
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full ps-10 pe-3.5 py-2.5 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-600"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        {t.auth.passwordLabel}
                      </label>
                      {mode === 'login' && (
                        <button
                          type="button"
                          onClick={handleReset}
                          className="text-xs text-red-600 dark:text-red-500 hover:underline"
                        >
                          {t.auth.resetPassword}
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-zinc-400 absolute top-3 start-3.5 pointer-events-none" />
                      <input
                        type="password"
                        required
                        minLength={6}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full ps-10 pe-3.5 py-2.5 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-600"
                      />
                    </div>
                  </div>

                  {authError && (
                    <div className="p-3.5 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300 leading-relaxed">
                      {authError === 'OPERATION_NOT_ALLOWED' ? t.auth.emailProviderHelp : authError}
                    </div>
                  )}

                  {statusMessage && (
                    <div className="p-3.5 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-xs text-emerald-800 dark:text-emerald-300 leading-relaxed">
                      {statusMessage}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full px-4 py-2.5 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-60"
                  >
                    {mode === 'login' ? t.auth.signInEmail : t.auth.createAccount}
                  </button>
                </form>

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      clearAuthError();
                      setStatusMessage(null);
                      setMode((prev) => (prev === 'login' ? 'register' : 'login'));
                    }}
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    {mode === 'login' ? t.auth.switchToRegister : t.auth.switchToLogin}
                  </button>
                </div>

                <p className="text-xs text-zinc-500 dark:text-zinc-500 leading-relaxed border-t border-zinc-200 dark:border-zinc-800 pt-4">
                  {t.auth.enterpriseProvidersNote}
                </p>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
