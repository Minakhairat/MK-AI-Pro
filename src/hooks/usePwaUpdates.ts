import { useCallback, useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { isDesktopApp } from '../lib/desktopClient';

export function usePwaUpdates() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [checking, setChecking] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const updateFnRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    if (isDesktopApp() || typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    try {
      const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
          setUpdateAvailable(true);
        },
        onOfflineReady() {
          setOfflineReady(true);
        },
        onRegisteredSW(_swUrl, registration) {
          if (registration) {
            registrationRef.current = registration;
          }
        },
      });
      updateFnRef.current = updateSW;
    } catch {
      // Service worker registration skipped in unsupported/non-HTTPS test environments
    }
  }, []);

  const applyUpdate = useCallback(async () => {
    if (updateFnRef.current) {
      await updateFnRef.current(true);
    } else if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }, []);

  const checkForUpdates = useCallback(async (): Promise<boolean> => {
    setChecking(true);
    try {
      if (registrationRef.current) {
        await registrationRef.current.update();
        return Boolean(registrationRef.current.waiting);
      }
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          registrationRef.current = reg;
          await reg.update();
          const hasWaiting = Boolean(reg.waiting);
          if (hasWaiting) setUpdateAvailable(true);
          return hasWaiting;
        }
      }
      return false;
    } catch {
      return false;
    } finally {
      setChecking(false);
    }
  }, []);

  const dismissUpdate = useCallback(() => {
    setUpdateAvailable(false);
  }, []);

  const dismissOfflineReady = useCallback(() => {
    setOfflineReady(false);
  }, []);

  return {
    updateAvailable,
    offlineReady,
    checking,
    applyUpdate,
    checkForUpdates,
    dismissUpdate,
    dismissOfflineReady,
  };
}
