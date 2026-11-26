/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { AuthScreen } from './components/auth/AuthScreen';
import { ArchitectureView } from './components/architecture/ArchitectureView';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { OfflineIndicator } from './components/common/OfflineIndicator';
import { DashboardView } from './components/dashboard/DashboardView';
import { DesktopSetupWizard } from './components/desktop/DesktopSetupWizard';
import { DesktopStatusView } from './components/desktop/DesktopStatusView';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { MobileBottomNav, type MobileTabId } from './components/mobile/MobileBottomNav';
import { MobileTopBar } from './components/mobile/MobileTopBar';
import { MobileWorkspaceView } from './components/mobile/MobileWorkspaceView';
import { ModelHubView } from './components/models/ModelHubView';
import { CreateProjectModal } from './components/projects/CreateProjectModal';
import { ProjectWorkspaceView } from './components/projects/ProjectWorkspaceView';
import { NotificationCenterModal } from './components/pwa/NotificationCenterModal';
import { PwaUpdateBanner } from './components/pwa/PwaUpdateBanner';
import { AccountSettingsView } from './components/settings/AccountSettingsView';
import { WorkspacesView } from './components/workspaces/WorkspacesView';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { I18nProvider, useI18n } from './contexts/I18nContext';
import { NotificationProvider, useNotifications } from './contexts/NotificationContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { usePwaUpdates } from './hooks/usePwaUpdates';
import { getDesktopBridge, isDesktopApp } from './lib/desktopClient';
import {
  cacheProjectSnapshots,
  flushOfflineSyncQueue,
  listOfflineSyncQueue,
} from './lib/mobileOfflineStore';
import {
  subscribeActivityLogs,
  subscribeProjects,
  subscribeUserTrainingRuns,
  subscribeWorkspaces,
} from './services/firestoreService';
import type { ActivityLog, AppSection, Project, TrainingRun, Workspace } from './types/domain';

function WorkspaceShell() {
  const { user, profile, loading } = useAuth();
  const { t, locale } = useI18n();
  const { pushNotification } = useNotifications();
  const {
    updateAvailable,
    checking: checkingUpdate,
    applyUpdate,
    checkForUpdates,
    dismissUpdate,
  } = usePwaUpdates();

  const [section, setSection] = useState<AppSection>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() => {
    if (typeof window === 'undefined' || isDesktopApp()) return false;
    return window.matchMedia('(max-width: 1023px)').matches;
  });
  const [forceDesktopLayout, setForceDesktopLayout] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTabId>('home');
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [pendingQueueCount, setPendingQueueCount] = useState(0);

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [trainingRuns, setTrainingRuns] = useState<TrainingRun[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [setupWizardOpen, setSetupWizardOpen] = useState(false);
  const prevRunStatusRef = useRef<Map<string, string>>(new Map());

  // Responsive viewport listener (<1024px activates dedicated Mobile PWA shell)
  useEffect(() => {
    if (typeof window === 'undefined' || isDesktopApp()) return;
    const mq = window.matchMedia('(max-width: 1023px)');
    const update = () => setIsMobileViewport(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // PWA App Shortcuts (?action=new-project, ?mobileTab=capture|train|models|home|more)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    const tab = params.get('mobileTab') as MobileTabId | null;
    if (action === 'new-project') {
      setCreateModalOpen(true);
    }
    if (tab && ['home', 'capture', 'train', 'models', 'more'].includes(tab)) {
      setMobileTab(tab);
    }
    if (action || tab) {
      params.delete('action');
      params.delete('mobileTab');
      const nextQuery = params.toString();
      const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`;
      window.history.replaceState({}, '', nextUrl);
    }
  }, []);

  // Online/offline tracking & auto-flush consented offline queue
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refreshCount = () =>
      void listOfflineSyncQueue()
        .then((q) => setPendingQueueCount(q.length))
        .catch(() => {});
    refreshCount();

    const onOnline = () => {
      setIsOnline(true);
      void flushOfflineSyncQueue()
        .then((res) => {
          if (res.succeeded > 0) {
            pushNotification({
              category: 'sync_completed',
              title: locale === 'ar' ? 'تمت المزامنة تلقائياً' : 'Offline Sync Complete',
              body: `${res.succeeded} queued item(s) synced.`,
            });
          }
          refreshCount();
        })
        .catch(() => refreshCount());
    };
    const onOffline = () => {
      setIsOnline(false);
      refreshCount();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [locale, pushNotification]);

  useEffect(() => {
    if (updateAvailable) {
      pushNotification({
        category: 'pwa_update',
        title: locale === 'ar' ? 'تحديث التطبيق جاهز' : 'MK AI Update Ready',
        body: locale === 'ar' ? 'أعد التحميل لتفعيل النسخة الجديدة.' : 'Tap Update to reload the latest PWA release.',
      });
    }
  }, [updateAvailable, locale, pushNotification]);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    bridge
      .getConfig()
      .then((cfg) => {
        if (!cfg.firstLaunchCompleted) {
          setSetupWizardOpen(true);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user || !user.emailVerified) {
      setWorkspaces([]);
      setProjects([]);
      setActivityLogs([]);
      setTrainingRuns([]);
      setSelectedProjectId(null);
      setLoadingProjects(false);
      return;
    }

    setLoadingProjects(true);
    const unsubWs = subscribeWorkspaces(user.uid, (items) => setWorkspaces(items));
    const unsubProj = subscribeProjects(user.uid, (items) => {
      setProjects(items);
      void cacheProjectSnapshots(items);
      setLoadingProjects(false);
    });
    const unsubLogs = subscribeActivityLogs(user.uid, (items) => setActivityLogs(items));
    const unsubRuns = subscribeUserTrainingRuns(user.uid, (items) => {
      for (const run of items) {
        const prev = prevRunStatusRef.current.get(run.id);
        if (prev && prev !== run.status) {
          if (run.status === 'completed') {
            pushNotification({
              category: 'training_completed',
              title: locale === 'ar' ? 'اكتمل التدريب' : 'Training Completed',
              body: `${run.architecture} (${run.currentEpoch}/${run.totalEpochs})`,
              deliverBrowserPush: true,
            });
          } else if (run.status === 'failed') {
            pushNotification({
              category: 'training_failed',
              title: locale === 'ar' ? 'فشل التدريب' : 'Training Failed',
              body: run.errorMessage || run.architecture,
              deliverBrowserPush: true,
            });
          }
        }
        prevRunStatusRef.current.set(run.id, run.status);
      }
      setTrainingRuns(items);
    });

    return () => {
      unsubWs();
      unsubProj();
      unsubLogs();
      unsubRuns();
    };
  }, [user, locale, pushNotification]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 text-sm">
        {t.common.loading}
      </div>
    );
  }

  if (!user || !user.emailVerified) {
    return <AuthScreen />;
  }

  const useMobileShell = isMobileViewport && !isDesktopApp() && !forceDesktopLayout;

  if (useMobileShell) {
    const tabTitles: Record<MobileTabId, string> = {
      home: locale === 'ar' ? 'MK AI الهاتف' : 'MK AI Mobile',
      capture: locale === 'ar' ? 'الالتقاط والتعليق' : 'Capture & Label',
      train: locale === 'ar' ? 'التدريب والنماذج' : 'Train Models',
      models: locale === 'ar' ? 'النماذج والمشاركة' : 'Models & Share',
      more: locale === 'ar' ? 'الإعدادات والاقتران' : 'Settings & Pairing',
    };

    const currentProjectName = projects.find((p) => p.id === selectedProjectId)?.name;

    return (
      <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
        <MobileTopBar
          title={tabTitles[mobileTab]}
          subtitle={currentProjectName}
          isOnline={isOnline}
          showBack={mobileTab !== 'home'}
          onBack={() => setMobileTab('home')}
          onCreateProject={() => setCreateModalOpen(true)}
          onOpenNotifications={() => setNotificationsOpen(true)}
          onSwitchToDesktopLayout={() => setForceDesktopLayout(true)}
        />

        <main className="flex-1 p-3 pb-24 max-w-xl w-full mx-auto">
          <MobileWorkspaceView
            activeTab={mobileTab}
            onSelectTab={setMobileTab}
            profile={profile}
            projects={projects}
            selectedProjectId={selectedProjectId}
            onSelectProject={(id) => setSelectedProjectId(id)}
            trainingRuns={trainingRuns}
            isOnline={isOnline}
            updateAvailable={updateAvailable}
            checkingUpdate={checkingUpdate}
            onCheckForUpdates={checkForUpdates}
            onApplyUpdate={applyUpdate}
            onCreateProject={() => setCreateModalOpen(true)}
            onOpenNotifications={() => setNotificationsOpen(true)}
            onSwitchToDesktopLayout={() => setForceDesktopLayout(true)}
          />
        </main>

        <MobileBottomNav
          activeTab={mobileTab}
          onSelectTab={setMobileTab}
          queueBadge={pendingQueueCount}
        />

        <CreateProjectModal
          open={createModalOpen}
          ownerUid={user.uid}
          workspaces={workspaces}
          onClose={() => setCreateModalOpen(false)}
          onCreated={(proj) => {
            setSelectedProjectId(proj.id);
            setMobileTab('capture');
          }}
        />

        <PwaUpdateBanner
          updateAvailable={updateAvailable}
          onApplyUpdate={() => void applyUpdate()}
          onDismiss={dismissUpdate}
        />

        <NotificationCenterModal
          open={notificationsOpen}
          onClose={() => setNotificationsOpen(false)}
        />
      </div>
    );
  }

  const activeProject = selectedProjectId
    ? projects.find((p) => p.id === selectedProjectId) || null
    : null;

  const breadcrumbs = activeProject
    ? [t.brandName, t.nav.projects, activeProject.name]
    : [t.brandName, section === 'model_hub' ? t.nav.modelHub : t.nav[section]];

  return (
    <div className="min-h-screen flex bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <Sidebar
        activeSection={section}
        onSelectSection={(next) => {
          setSection(next);
          setSelectedProjectId(null);
        }}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          breadcrumbs={breadcrumbs}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onCreateProject={() => setCreateModalOpen(true)}
          onOpenNotifications={() => setNotificationsOpen(true)}
          showBackButton={Boolean(activeProject) || forceDesktopLayout}
          onBack={() => {
            if (activeProject) {
              setSelectedProjectId(null);
            } else if (forceDesktopLayout) {
              setForceDesktopLayout(false);
            }
          }}
        />

        <main className="flex-1 p-4 sm:p-8 overflow-y-auto">
          {activeProject ? (
            <ProjectWorkspaceView
              project={activeProject}
              onDeleted={() => setSelectedProjectId(null)}
            />
          ) : section === 'dashboard' || section === 'projects' ? (
            <DashboardView
              mode={section}
              profile={profile}
              projects={projects}
              activityLogs={activityLogs}
              trainingRuns={trainingRuns}
              loadingProjects={loadingProjects}
              onCreateProject={() => setCreateModalOpen(true)}
              onOpenProject={(proj) => {
                setSection('projects');
                setSelectedProjectId(proj.id);
              }}
            />
          ) : section === 'model_hub' ? (
            <div className="max-w-7xl mx-auto">
              <ModelHubView />
            </div>
          ) : section === 'desktop' ? (
            <DesktopStatusView onOpenWizard={() => setSetupWizardOpen(true)} />
          ) : section === 'workspaces' ? (
            <WorkspacesView workspaces={workspaces} />
          ) : section === 'architecture' ? (
            <ArchitectureView />
          ) : (
            <AccountSettingsView />
          )}
        </main>
      </div>

      <CreateProjectModal
        open={createModalOpen}
        ownerUid={user.uid}
        workspaces={workspaces}
        onClose={() => setCreateModalOpen(false)}
        onCreated={(proj) => {
          setSection('projects');
          setSelectedProjectId(proj.id);
        }}
      />

      <DesktopSetupWizard
        open={setupWizardOpen}
        onClose={() => setSetupWizardOpen(false)}
      />

      <PwaUpdateBanner
        updateAvailable={updateAvailable}
        onApplyUpdate={() => void applyUpdate()}
        onDismiss={dismissUpdate}
      />

      <NotificationCenterModal
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <I18nProvider>
          <NotificationProvider>
            <AuthProvider>
              <WorkspaceShell />
              <OfflineIndicator />
            </AuthProvider>
          </NotificationProvider>
        </I18nProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
