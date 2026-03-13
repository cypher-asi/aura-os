import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { EventProvider } from "./context/EventContext";
import { AppShell } from "./components/AppShell";
import { HomeView } from "./views/HomeView";
import { NewProjectView } from "./views/NewProjectView";
import { ProjectLayout } from "./views/ProjectLayout";
import { ChatView } from "./components/ChatView";
import { SettingsView } from "./views/SettingsView";
import { ExecutionView } from "./views/ExecutionView";

export default function App() {
  return (
    <BrowserRouter>
      <EventProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<HomeView />} />
            <Route path="new-project" element={<NewProjectView />} />
            <Route path="settings" element={<SettingsView />} />
            <Route path="projects/:projectId" element={<ProjectLayout />}>
              <Route index element={<Navigate to="chat" replace />} />
              <Route path="chat" element={<ChatView />} />
              <Route path="chat/:chatSessionId" element={<ChatView />} />
              <Route path="execution" element={<ExecutionView />} />
            </Route>
          </Route>
        </Routes>
      </EventProvider>
    </BrowserRouter>
  );
}
