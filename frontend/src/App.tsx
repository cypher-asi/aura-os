import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { EventProvider } from "./context/EventContext";
import { RequireAuth } from "./components/RequireAuth";
import { AppShell } from "./components/AppShell";
import { HomeView } from "./views/HomeView";
import { ProjectLayout } from "./views/ProjectLayout";
import { ChatView } from "./components/ChatView";
import { SettingsView } from "./views/SettingsView";
import { ExecutionView } from "./views/ExecutionView";
import { LoginView } from "./views/LoginView";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <EventProvider>
          <Routes>
            <Route path="login" element={<LoginView />} />
            <Route element={<RequireAuth />}>
              <Route element={<AppShell />}>
                <Route index element={<HomeView />} />
                <Route path="settings" element={<SettingsView />} />
                <Route path="projects/:projectId" element={<ProjectLayout />}>
                  <Route index element={<Navigate to="chat" replace />} />
                  <Route path="chat" element={<ChatView />} />
                  <Route path="chat/:chatSessionId" element={<ChatView />} />
                  <Route path="execution" element={<ExecutionView />} />
                </Route>
              </Route>
            </Route>
          </Routes>
        </EventProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
