import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  type AppNotificationCategory,
  type AppNotificationItem,
  sortAndCapNotifications,
} from '../lib/notificationUtils';

export { type AppNotificationCategory, type AppNotificationItem, sortAndCapNotifications };

const STORAGE_KEY = 'mk_ai_notifications_v1';

interface NotificationContextValue {
  notifications: AppNotificationItem[];
  unreadCount: number;
  browserPermission: NotificationPermission | 'unsupported';
  requestBrowserPermission: () => Promise<NotificationPermission | 'unsupported'>;
  pushNotification: (params: {
    category: AppNotificationCategory;
    title: string;
    body: string;
    deliverBrowserPush?: boolean;
  }) => void;
  markAllRead: () => void;
  markRead: (id: string) => void;
  clearNotifications: () => void;
}

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotificationItem[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as AppNotificationItem[];
      return Array.isArray(parsed) ? sortAndCapNotifications(parsed) : [];
    } catch {
      return [];
    }
  });

  const [browserPermission, setBrowserPermission] = useState<NotificationPermission | 'unsupported'>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return window.Notification.permission;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
    } catch {
      // Ignore quota errors
    }
  }, [notifications]);

  const requestBrowserPermission = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setBrowserPermission('unsupported');
      return 'unsupported' as const;
    }
    try {
      const perm = await window.Notification.requestPermission();
      setBrowserPermission(perm);
      return perm;
    } catch {
      return window.Notification.permission;
    }
  }, []);

  const pushNotification = useCallback(
    (params: {
      category: AppNotificationCategory;
      title: string;
      body: string;
      deliverBrowserPush?: boolean;
    }) => {
      const entry: AppNotificationItem = {
        id: `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        category: params.category,
        title: params.title,
        body: params.body,
        createdAt: new Date().toISOString(),
        read: false,
      };
      setNotifications((prev) => sortAndCapNotifications([entry, ...prev]));

      if (
        params.deliverBrowserPush &&
        typeof window !== 'undefined' &&
        'Notification' in window &&
        window.Notification.permission === 'granted'
      ) {
        if ('serviceWorker' in navigator) {
          void navigator.serviceWorker.ready
            .then((reg) =>
              reg.showNotification(params.title, {
                body: params.body,
                icon: './pwa-192x192.png',
                badge: './pwa-192x192.png',
                tag: params.category,
              })
            )
            .catch(() => {
              try {
                new window.Notification(params.title, { body: params.body });
              } catch {
                // ignore
              }
            });
        } else {
          try {
            new window.Notification(params.title, { body: params.body });
          } catch {
            // ignore
          }
        }
      }
    },
    []
  );

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        browserPermission,
        requestBrowserPermission,
        pushNotification,
        markAllRead,
        markRead,
        clearNotifications,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotifications must be used within NotificationProvider');
  }
  return ctx;
}
