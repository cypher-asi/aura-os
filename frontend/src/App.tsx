import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { EventProvider } from "./context/EventContext";
import { AppShell } from "./components/AppShell";
import { HomeView } from "./views/HomeView";
import { NewProjectView } from "./views/NewProjectView";
import { ProjectLayout } from "./views/ProjectLayout";
import { SpecList } from "./views/SpecList";
import { SpecViewer } from "./views/SpecViewer";
import { TaskList } from "./views/TaskList";
import { ProgressDashboard } from "./views/ProgressDashboard";
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
              <Route index element={<Navigate to="specs" replace />} />
              <Route path="specs" element={<SpecList />} />
              <Route path="specs/:specId" element={<SpecViewer />} />
              <Route path="tasks" element={<TaskList />} />
              <Route path="progress" element={<ProgressDashboard />} />
              <Route path="execution" element={<ExecutionView />} />
            </Route>
          </Route>
        </Routes>
      </EventProvider>
    </BrowserRouter>
  );
}
