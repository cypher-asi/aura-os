import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { EventProvider } from "./context/EventContext";
import { FollowProvider } from "./context/FollowContext";
import { HostProvider } from "./context/HostContext";
import { RequireAuth } from "./components/RequireAuth";
import { AppShell } from "./components/AppShell";
import { HomeView } from "./views/HomeView";
import { ProjectLayout } from "./views/ProjectLayout";
import { ChatView } from "./components/ChatView";
import { SettingsView } from "./views/SettingsView";
import { ExecutionView } from "./views/ExecutionView";
import { LoginView } from "./views/LoginView";
import { InviteAcceptView } from "./views/InviteAcceptView";
import { AgentChatView } from "./apps/agents/AgentChatView";
import { AgentIndexRedirect } from "./apps/agents/AgentIndexRedirect";
import { IdeView } from "./views/IdeView";
import { ProjectEmptyView } from "./views/ProjectEmptyView";

export default function App() {
  return (
    <BrowserRouter>
      <HostProvider>
        <AuthProvider>
          <EventProvider>
            <FollowProvider>
              <Routes>
                <Route path="login" element={<LoginView />} />
                <Route path="ide" element={<IdeView />} />
                <Route element={<RequireAuth />}>
                  <Route path="invite/:token" element={<InviteAcceptView />} />
                  <Route element={<AppShell />}>
                    {/* Redirect root to /projects */}
                    <Route index element={<Navigate to="/projects" replace />} />

                    {/* Projects app routes */}
                    <Route path="projects" element={<HomeView />} />
                    <Route path="projects/settings" element={<SettingsView />} />
                    <Route path="projects/:projectId" element={<ProjectLayout />}>
                      <Route index element={<ProjectEmptyView />} />
                      <Route path="agents/:agentInstanceId" element={<ChatView />} />
                      <Route path="execution" element={<ExecutionView />} />
                    </Route>

                    {/* Agents app routes */}
                    <Route path="agents" element={<AgentIndexRedirect />} />
                    <Route path="agents/:agentId" element={<AgentChatView />} />

                    {/* Leaderboard app routes */}
                    <Route path="leaderboard" element={null} />

                    {/* Feed app routes */}
                    <Route path="feed" element={null} />

                    {/* Profile app routes */}
                    <Route path="profile" element={null} />
                  </Route>
                </Route>
              </Routes>
            </FollowProvider>
          </EventProvider>
        </AuthProvider>
      </HostProvider>
    </BrowserRouter>
  );
}
