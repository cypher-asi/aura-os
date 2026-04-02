import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { useAuthStore } from "./stores/auth-store";
import { RequireAuth } from "./components/RequireAuth";
import { AppShell } from "./components/AppShell";
import { HomeView } from "./views/HomeView";
import { ProjectLayout } from "./views/ProjectLayout";
import { AgentChatView } from "./components/AgentChatView";
import { SettingsView } from "./views/SettingsView";
import { ExecutionView } from "./views/ExecutionView";
import { LoginView } from "./views/LoginView";
import { InviteAcceptView } from "./views/InviteAcceptView";
import { AgentIndexRedirect } from "./apps/agents/AgentIndexRedirect";
import { IdeView } from "./views/IdeView";
import { ProjectAgentRedirectView } from "./views/ProjectAgentRedirectView";
import { ProjectRootRedirectView } from "./views/ProjectRootRedirectView/ProjectRootRedirectView";
import { ProjectWorkView } from "./views/ProjectWorkView";
import { ProjectFilesView } from "./views/ProjectFilesView";
import { ProjectStatsView } from "./views/ProjectStatsView";
import { apps } from "./apps/registry";
import { getLastApp } from "./utils/storage";

import "./stores/event-store";
import "./stores/follow-store";
import "./stores/profile-status-store";

const DEFAULT_APP_PATH = "/agents";

function LastAppRedirect() {
  const lastAppId = getLastApp();
  const target = lastAppId ? apps.find((a) => a.id === lastAppId) : null;
  return <Navigate to={target?.basePath ?? DEFAULT_APP_PATH} replace />;
}

export default function App() {
  const restoreSession = useAuthStore((s) => s.restoreSession);
  useEffect(() => { restoreSession(); }, [restoreSession]);
  useEffect(() => {
    const startupPayload = {
      runId: "drag-rootcause-pre",
      hypothesisId: "H5",
      location: "App.tsx:useEffect(startup)",
      message: "app_start_probe",
      pathname: window.location.pathname,
      timestamp: Date.now(),
    };
    // #region agent log
    console.debug("[drag-debug]", startupPayload);
    console.debug("[drag-debug-json]", JSON.stringify(startupPayload));
    // #endregion
    // #region agent log
    fetch("http://127.0.0.1:7836/ingest/c96ab900-9f38-42f7-81b1-bd596c64b5c4", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5df55f" }, body: JSON.stringify({ sessionId: "5df55f", runId: "drag-rootcause-pre", hypothesisId: "H5", location: "App.tsx:useEffect(startup)", message: "app_start_probe", data: { pathname: window.location.pathname }, timestamp: Date.now() }) }).catch(() => {});
    // #endregion
  }, []);

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
            <Route path="projects/settings" element={<SettingsView />} />
            <Route path="projects/:projectId" element={<ProjectLayout />}>
              <Route index element={<ProjectRootRedirectView />} />
              <Route path="agent" element={<ProjectAgentRedirectView />} />
              <Route path="agents/:agentInstanceId" element={<AgentChatView />} />
              <Route path="execution" element={<ExecutionView />} />
              <Route path="work" element={<ProjectWorkView />} />
              <Route path="files" element={<ProjectFilesView />} />
              <Route path="stats" element={<ProjectStatsView />} />
            </Route>

            <Route path="agents" element={<AgentIndexRedirect />} />
            <Route path="agents/:agentId" element={<AgentChatView />} />

            <Route path="tasks" element={null} />
            <Route path="tasks/:projectId" element={null} />
            <Route path="tasks/:projectId/agents/:agentInstanceId" element={null} />

            <Route path="process" element={null} />
            <Route path="process/:processId" element={null} />

            <Route path="leaderboard" element={null} />
            <Route path="feed" element={null} />
            <Route path="profile" element={null} />
            <Route path="desktop" element={null} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
