import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { useAuthStore } from "./stores/auth-store";
import { RequireAuth } from "./components/RequireAuth";
import { AppShell } from "./components/AppShell";
import { useAuraCapabilities } from "./hooks/use-aura-capabilities";
import { HomeView } from "./views/HomeView";
import { MobileOrganizationView } from "./views/MobileOrganizationView";
import { ProjectLayout } from "./views/ProjectLayout";
import { AgentChatView } from "./components/AgentChatView";
import { SettingsView } from "./views/SettingsView";
import { ExecutionView } from "./views/ExecutionView";
import { LoginView } from "./views/LoginView";
import { InviteAcceptView } from "./views/InviteAcceptView";
import { AgentIndexRedirect } from "./apps/agents/AgentIndexRedirect";
import { ProcessIndexRedirect } from "./apps/process/ProcessIndexRedirect";
import { IdeView } from "./views/IdeView";
import { ProjectAgentRedirectView } from "./views/ProjectAgentRedirectView";
import { ProjectRootRedirectView } from "./views/ProjectRootRedirectView";
import { ProjectWorkView } from "./views/ProjectWorkView";
import { ProjectTasksView } from "./views/ProjectTasksView";
import { ProjectFilesView } from "./views/ProjectFilesView";
import { ProjectProcessView } from "./views/ProjectProcessView";
import { ProjectStatsView } from "./views/ProjectStatsView";
import { ProjectAgentDetailsView } from "./views/ProjectAgentDetailsView";
import { ProjectAgentSetupView } from "./views/ProjectAgentSetupView/ProjectAgentSetupView";
import { apps } from "./apps/registry";
import { getLastApp } from "./utils/storage";
import { bootstrapNativeTestAuth } from "./lib/native-test-auth";
import { hydrateStoredAuth } from "./lib/auth-token";

import "./stores/event-store/index";
import "./stores/follow-store";
import "./stores/profile-status-store";

const DEFAULT_APP_PATH = "/agents";

function LastAppRedirect() {
  const lastAppId = getLastApp();
  const target = lastAppId ? apps.find((a) => a.id === lastAppId) : null;
  return <Navigate to={target?.basePath ?? DEFAULT_APP_PATH} replace />;
}

function MobileOrganizationRoute() {
  const { isMobileLayout } = useAuraCapabilities();
  return isMobileLayout ? <MobileOrganizationView /> : <Navigate to="/projects" replace />;
}

export default function App() {
  const restoreSession = useAuthStore((s) => s.restoreSession);
  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        await hydrateStoredAuth();
        await bootstrapNativeTestAuth();
      } catch (error) {
        console.error("Native test auth bootstrap failed", error);
      } finally {
        if (active) {
          await restoreSession();
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [restoreSession]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="login" element={<LoginView />} />
        <Route path="ide" element={<IdeView />} />
        <Route element={<RequireAuth />}>
          <Route path="invite/:token" element={<InviteAcceptView />} />
          <Route element={<AppShell />}>
            <Route index element={<LastAppRedirect />} />

            <Route path="projects" element={<HomeView />} />
            <Route path="projects/organization" element={<MobileOrganizationRoute />} />
            <Route path="projects/settings" element={<SettingsView />} />
            <Route path="projects/:projectId" element={<ProjectLayout />}>
              <Route index element={<ProjectRootRedirectView />} />
              <Route path="agent" element={<ProjectAgentRedirectView />} />
              <Route path="agents/create" element={<ProjectAgentSetupView mode="create" />} />
              <Route path="agents/attach" element={<ProjectAgentSetupView mode="existing" />} />
              <Route path="agents/:agentInstanceId/details" element={<ProjectAgentDetailsView />} />
              <Route path="agents/:agentInstanceId" element={<AgentChatView />} />
              <Route path="execution" element={<ExecutionView />} />
              <Route path="work" element={<ProjectWorkView />} />
              <Route path="tasks" element={<ProjectTasksView />} />
              <Route path="files" element={<ProjectFilesView />} />
              <Route path="process" element={<ProjectProcessView />} />
              <Route path="stats" element={<ProjectStatsView />} />
            </Route>

            <Route path="agents" element={<AgentIndexRedirect />} />
            <Route path="agents/:agentId" element={<AgentChatView />} />

            <Route path="tasks" element={null} />
            <Route path="tasks/:projectId" element={null} />
            <Route path="tasks/:projectId/agents/:agentInstanceId" element={null} />

            <Route path="process" element={<ProcessIndexRedirect />} />
            <Route path="process/:processId" element={null} />

            <Route path="feed" element={null} />
            <Route path="profile" element={null} />
            <Route path="desktop" element={null} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
