import React from 'react';
import { Bell, BellRing, CheckCheck, Trash2, X } from 'lucide-react';
import { useI18n } from '../../contexts/I18nContext';
import { useNotifications } from '../../contexts/NotificationContext';

interface NotificationCenterModalProps {
  open: boolean;
  onClose: () => void;
}

export function NotificationCenterModal({ open, onClose }: NotificationCenterModalProps) {
  const { locale } = useI18n();
  const {
    notifications,
    unreadCount,
    browserPermission,
    requestBrowserPermission,
    markAllRead,
    markRead,
    clearNotifications,
  } = useNotifications();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full sm:max-w-md max-h-[85vh] flex flex-col rounded-t-3xl sm:rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden">
        <div className="w-10 h-1.5 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-auto mt-3 sm:hidden" />

        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-red-600" />
            <h2 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100">
              {locale === 'ar' ? 'مركز الإشعارات' : 'Notification Center'}
            </h2>
            {unreadCount > 0 && (
              <span className="font-mono text-xs font-semibold text-red-600">
                ({unreadCount})
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notifications"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Permission & Bulk Controls */}
        <div className="px-5 py-3 bg-zinc-50 dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          {browserPermission === 'default' && (
            <button
              type="button"
              onClick={() => void requestBrowserPermission()}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-600 text-white font-semibold"
            >
              <BellRing className="w-3.5 h-3.5" />
              <span>
                {locale === 'ar' ? 'تفعيل إشعارات النظام' : 'Enable Device Alerts'}
              </span>
            </button>
          )}
          {browserPermission === 'granted' && (
            <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              {locale === 'ar' ? 'إشعارات النظام مفعّلة' : 'Device alerts active'}
            </span>
          )}
          {browserPermission === 'denied' && (
            <span className="text-[11px] text-amber-600 dark:text-amber-400">
              {locale === 'ar'
                ? 'إشعارات المتصفح محظورة من الإعدادات'
                : 'Browser alerts blocked in OS settings'}
            </span>
          )}
          {browserPermission === 'unsupported' && (
            <span className="text-[11px] text-zinc-500">
              {locale === 'ar' ? 'تنبيهات داخل التطبيق مفعّلة' : 'In-app feed active'}
            </span>
          )}

          <div className="flex items-center gap-1.5 ms-auto">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="min-h-[44px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>{locale === 'ar' ? 'تحديد كمقروء' : 'Read all'}</span>
              </button>
            )}
            {notifications.length > 0 && (
              <button
                type="button"
                onClick={clearNotifications}
                className="min-h-[44px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-red-600"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{locale === 'ar' ? 'مسح' : 'Clear'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Feed */}
        <div className="flex-1 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800 pb-[env(safe-area-inset-bottom)]">
          {notifications.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500">
              {locale === 'ar'
                ? 'لا توجد إشعارات حالياً. ستظهر هنا تنبيهات اكتمال التدريب والمزامنة والاقتران.'
                : 'No notifications yet. Training completions, failures, sync events, and desktop pairing alerts appear here.'}
            </div>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => markRead(n.id)}
                className={`w-full text-start p-4 transition-colors flex items-start justify-between gap-3 min-h-[56px] ${
                  n.read
                    ? 'bg-white dark:bg-zinc-900'
                    : 'bg-red-50/40 dark:bg-red-950/15'
                }`}
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {!n.read && <span className="w-2 h-2 rounded-full bg-red-600 shrink-0" />}
                    <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                      {n.title}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    {n.body}
                  </p>
                  <p className="text-[10px] font-mono text-zinc-400 tabular-nums">
                    {new Date(n.createdAt).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US')}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
