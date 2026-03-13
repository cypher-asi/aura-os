import { BrowserRouter, Routes, Route } from "react-router-dom";
import { EventProvider } from "./context/EventContext";
import { AppShell } from "./components/AppShell";
import { HomeView } from "./views/HomeView";
import { NewProjectView } from "./views/NewProjectView";
import { ProjectDetail } from "./views/ProjectDetail";
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
            <Route path="projects/:projectId" element={<ProjectDetail />} />
            <Route path="projects/:projectId/specs" element={<SpecList />} />
            <Route path="projects/:projectId/specs/:specId" element={<SpecViewer />} />
            <Route path="projects/:projectId/tasks" element={<TaskList />} />
            <Route path="projects/:projectId/progress" element={<ProgressDashboard />} />
            <Route path="projects/:projectId/execution" element={<ExecutionView />} />
          </Route>
        </Routes>
      </EventProvider>
    </BrowserRouter>
  );
}
