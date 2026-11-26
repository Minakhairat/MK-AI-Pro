import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  HardDrive,
  RefreshCw,
  Shield,
  UploadCloud,
  UserCheck,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { verifyServerSession } from '../../lib/apiClient';
import {
  type MobileStorageQuotaSummary,
  type OfflineSyncQueueEntry,
  flushOfflineSyncQueue,
  getMobileStorageQuota,
  listOfflineSyncQueue,
} from '../../lib/mobileOfflineStore';
import { updateUserPreferences } from '../../services/firestoreService';
import { PWAInstallButton } from '../common/PWAInstallButton';

export function AccountSettingsView() {
  const { user, profile } = useAuth();
  const { t, locale } = useI18n();
  const { pushNotification } = useNotifications();

  const [displayName, setDisplayName] = useState(profile?.displayName || user?.displayName || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionResult, setSessionResult] = useState<string | null>(null);
  const [quota, setQuota] = useState<MobileStorageQuotaSummary | null>(null);
  const [queue, setQueue] = useState<OfflineSyncQueueEntry[]>([]);
  const [syncingQueue, setSyncingQueue] = useState(false);

  const loadStorageInfo = async () => {
    const [q, items] = await Promise.all([
      getMobileStorageQuota(),
      listOfflineSyncQueue(),
    ]);
    setQuota(q);
    setQueue(items);
  };

  useEffect(() => {
    setDisplayName(profile?.displayName || user?.displayName || '');
  }, [profile, user]);

  useEffect(() => {
    void loadStorageInfo();
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateUserPreferences({ uid: user.uid, displayName });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleVerifySession = async () => {
    setSessionResult(null);
    try {
      const res = await verifyServerSession();
      setSessionResult(`Verified UID: ${res.uid} (${res.email})`);
    } catch (err) {
      setSessionResult(err instanceof Error ? err.message : 'Verification failed.');
    }
  };

  const storageQuotaGb = ((profile?.storageQuotaBytes ?? 5_368_709_120) / 1024 ** 3).toFixed(1);

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-display font-bold text-zinc-900 dark:text-zinc-100">
          {t.settingsView.heading}
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {t.settingsView.subheading}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Profile Form */}
        <form
          onSubmit={handleSaveProfile}
          className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-4"
        >
          <div className="flex items-center gap-2 font-display font-semibold text-base">
            <UserCheck className="w-4 h-4 text-red-600 dark:text-red-500" />
            <h2>{t.settingsView.profileSection}</h2>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              {t.settingsView.displayNameLabel}
            </label>
            <input
              type="text"
              required
              minLength={1}
              maxLength={120}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              {t.settingsView.emailLabel}
            </label>
            <input
              type="email"
              disabled
              value={user?.email || ''}
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-500"
            />
          </div>

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          {saved && (
            <p className="text-xs text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{t.projectWorkspace.savedNotice}</span>
            </p>
          )}

          <div>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-60"
            >
              {t.settingsView.saveProfile}
            </button>
          </div>
        </form>

        {/* Plan & Credits */}
        <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-4">
          <div className="flex items-center gap-2 font-display font-semibold text-base">
            <CreditCard className="w-4 h-4 text-red-600 dark:text-red-500" />
            <h2>{t.settingsView.billingSection}</h2>
          </div>

          <div className="divide-y divide-zinc-100 dark:divide-zinc-800 text-sm">
            <div className="py-3 flex items-center justify-between">
              <span className="text-zinc-500 dark:text-zinc-400">
                {t.settingsView.currentPlan}
              </span>
              <span className="font-semibold">{t.settingsView.planFree}</span>
            </div>
            <div className="py-3 flex items-center justify-between tabular-nums">
              <span className="text-zinc-500 dark:text-zinc-400">
                {t.settingsView.creditsBalance}
              </span>
              <span className="font-mono font-semibold text-red-600 dark:text-red-500">
                {profile?.cloudCreditsBalance ?? 100}
              </span>
            </div>
            <div className="py-3 flex items-center justify-between tabular-nums">
              <span className="text-zinc-500 dark:text-zinc-400">
                {t.settingsView.storageQuota}
              </span>
              <span className="font-mono font-semibold">{storageQuotaGb} GB</span>
            </div>
          </div>
        </div>
      </div>

      {/* Security & Token Verification */}
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-4">
        <div className="flex items-center gap-2 font-display font-semibold text-base">
          <Shield className="w-4 h-4 text-red-600 dark:text-red-500" />
          <h2>{t.settingsView.securitySection}</h2>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {t.settingsView.twoFactorLabel}
          </p>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
            {t.settingsView.twoFactorDesc}
          </p>
        </div>

        <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <span className="text-xs text-zinc-600 dark:text-zinc-400 font-mono">
            {sessionResult || t.settingsView.sessionSection}
          </span>
          <button
            type="button"
            onClick={() => void handleVerifySession()}
            className="px-4 py-2 text-xs font-semibold rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
          >
            {t.settingsView.verifySessionBtn}
          </button>
        </div>
      </div>

      {/* Mobile PWA Install, Device Storage Quota & Offline Queue */}
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-display font-semibold text-base">
            <HardDrive className="w-4 h-4 text-red-600 dark:text-red-500" />
            <h2>
              {locale === 'ar'
                ? 'تطبيق الويب التقدمي والتخزين المحلي (PWA)'
                : 'PWA Offline Storage & Sync Queue'}
            </h2>
          </div>
          <PWAInstallButton />
        </div>

        {quota?.supported && (
          <div className="space-y-1.5 text-xs tabular-nums">
            <div className="flex justify-between font-mono text-zinc-600 dark:text-zinc-400">
              <span>
                Used: {(quota.usageBytes / (1024 * 1024)).toFixed(1)} MB
              </span>
              <span>
                Browser Quota: {(quota.quotaBytes / (1024 * 1024)).toFixed(0)} MB ({quota.percentUsed}%)
              </span>
            </div>
            <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
              <div
                style={{ width: `${Math.min(100, quota.percentUsed)}%` }}
                className="h-full bg-red-600"
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-zinc-100 dark:border-zinc-800 text-xs">
          <span className="font-mono text-zinc-600 dark:text-zinc-400">
            Pending Offline Queue Entries: {queue.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadStorageInfo()}
              className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 inline-flex items-center gap-1.5 font-semibold"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              disabled={queue.length === 0 || syncingQueue}
              onClick={() => {
                setSyncingQueue(true);
                void flushOfflineSyncQueue()
                  .then((res) => {
                    if (res.succeeded > 0) {
                      pushNotification({
                        category: 'sync_completed',
                        title: 'Offline Queue Synced',
                        body: `${res.succeeded} queued item(s) synced.`,
                      });
                    }
                    return loadStorageInfo();
                  })
                  .finally(() => setSyncingQueue(false));
              }}
              className="px-3 py-1.5 rounded-lg bg-red-600 text-white font-semibold inline-flex items-center gap-1.5 disabled:opacity-45"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span>{syncingQueue ? 'Syncing...' : 'Sync Queue Now'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
