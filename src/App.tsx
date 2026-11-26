/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { AuthScreen } from './components/auth/AuthScreen';
import { ArchitectureView } from './components/architecture/ArchitectureView';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { OfflineIndicator } from './components/common/OfflineIndicator';
import { DashboardView } from './components/dashboard/DashboardView';
import { DesktopSetupWizard } from './components/desktop/DesktopSetupWizard';
import { DesktopStatusView } from './components/desktop/DesktopStatusView';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { ModelHubView } from './components/models/ModelHubView';
import { CreateProjectModal } from './components/projects/CreateProjectModal';
import { ProjectWorkspaceView } from './components/projects/ProjectWorkspaceView';
import { AccountSettingsView } from './components/settings/AccountSettingsView';
import { WorkspacesView } from './components/workspaces/WorkspacesView';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { I18nProvider, useI18n } from './contexts/I18nContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { getDesktopBridge } from './lib/desktopClient';
import {
  subscribeActivityLogs,
  subscribeProjects,
  subscribeUserTrainingRuns,
  subscribeWorkspaces,
} from './services/firestoreService';
import type { ActivityLog, AppSection, Project, TrainingRun, Workspace } from './types/domain';

function WorkspaceShell() {
  const { user, profile, loading } = useAuth();
  const { t } = useI18n();

  const [section, setSection] = useState<AppSection>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [trainingRuns, setTrainingRuns] = useState<TrainingRun[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [setupWizardOpen, setSetupWizardOpen] = useState(false);

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
      setLoadingProjects(false);
    });
    const unsubLogs = subscribeActivityLogs(user.uid, (items) => setActivityLogs(items));
    const unsubRuns = subscribeUserTrainingRuns(user.uid, (items) => setTrainingRuns(items));

    return () => {
      unsubWs();
      unsubProj();
      unsubLogs();
      unsubRuns();
    };
  }, [user]);

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
          showBackButton={Boolean(activeProject)}
          onBack={() => setSelectedProjectId(null)}
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
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <WorkspaceShell />
            <OfflineIndicator />
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
