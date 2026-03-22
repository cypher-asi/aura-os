import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { useAuthStore } from "./stores/auth-store";
import { RequireAuth } from "./components/RequireAuth";
import { AppShell } from "./components/AppShell";
import { HomeView } from "./views/HomeView";
import { ProjectLayout } from "./views/ProjectLayout";
import { ChatView } from "./components/ChatView";
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

import "./stores/event-store";
import "./stores/follow-store";

export default function App() {
  const restoreSession = useAuthStore((s) => s.restoreSession);
  useEffect(() => { restoreSession(); }, [restoreSession]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="login" element={<LoginView />} />
        <Route path="ide" element={<IdeView />} />
        <Route element={<RequireAuth />}>
          <Route path="invite/:token" element={<InviteAcceptView />} />
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/agents" replace />} />

            <Route path="projects" element={<HomeView />} />
            <Route path="projects/settings" element={<SettingsView />} />
            <Route path="projects/:projectId" element={<ProjectLayout />}>
              <Route index element={<ProjectRootRedirectView />} />
              <Route path="agent" element={<ProjectAgentRedirectView />} />
              <Route path="agents/:agentInstanceId" element={<ChatView />} />
              <Route path="execution" element={<ExecutionView />} />
              <Route path="work" element={<ProjectWorkView />} />
              <Route path="files" element={<ProjectFilesView />} />
            </Route>

            <Route path="agents" element={<AgentIndexRedirect />} />
            <Route path="agents/:agentId" element={null} />

            <Route path="leaderboard" element={null} />
            <Route path="feed" element={null} />
            <Route path="profile" element={null} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
