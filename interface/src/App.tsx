import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { useAuthStore } from "./stores/auth-store";
import { useAppUIStore } from "./stores/app-ui-store";
import { RequireAuth } from "./components/RequireAuth";
import { AppShell } from "./components/AppShell";
import { useAuraCapabilities } from "./hooks/use-aura-capabilities";
import { MobileOrganizationView } from "./views/MobileOrganizationView";
import { LoginView } from "./views/LoginView";
import { AgentIndexRedirect } from "./apps/agents/AgentIndexRedirect";
import { ProcessIndexRedirect } from "./apps/process/ProcessIndexRedirect";
import { ShellRoutePlaceholder } from "./components/ShellRoutePlaceholder/ShellRoutePlaceholder";
import { getInitialShellPath } from "./utils/last-app-path";
import { getLastApp } from "./utils/storage";
import { bootstrapNativeTestAuth } from "./lib/native-test-auth";
import { hydrateStoredAuth } from "./lib/auth-token";

const HomeView = lazy(() => import("./views/HomeView").then((m) => ({ default: m.HomeView })));
const SettingsView = lazy(() => import("./views/SettingsView").then((m) => ({ default: m.SettingsView })));
const ProjectLayout = lazy(() => import("./views/ProjectLayout").then((m) => ({ default: m.ProjectLayout })));
const ProjectRootRedirectView = lazy(() =>
  import("./views/ProjectRootRedirectView").then((m) => ({ default: m.ProjectRootRedirectView })),
);
const ProjectAgentRedirectView = lazy(() =>
  import("./views/ProjectAgentRedirectView").then((m) => ({ default: m.ProjectAgentRedirectView })),
);
const ProjectAgentSetupView = lazy(() =>
  import("./views/ProjectAgentSetupView/ProjectAgentSetupView").then((m) => ({
    default: m.ProjectAgentSetupView,
  })),
);
const ProjectAgentDetailsView = lazy(() =>
  import("./views/ProjectAgentDetailsView").then((m) => ({ default: m.ProjectAgentDetailsView })),
);
const AgentChatView = lazy(() => import("./components/AgentChatView").then((m) => ({ default: m.AgentChatView })));
const ExecutionView = lazy(() => import("./views/ExecutionView").then((m) => ({ default: m.ExecutionView })));
const InviteAcceptView = lazy(() =>
  import("./views/InviteAcceptView").then((m) => ({ default: m.InviteAcceptView })),
);
const IdeView = lazy(() => import("./views/IdeView").then((m) => ({ default: m.IdeView })));
const ProjectWorkView = lazy(() => import("./views/ProjectWorkView").then((m) => ({ default: m.ProjectWorkView })));
const ProjectTasksView = lazy(() => import("./views/ProjectTasksView").then((m) => ({ default: m.ProjectTasksView })));
const ProjectFilesView = lazy(() => import("./views/ProjectFilesView").then((m) => ({ default: m.ProjectFilesView })));
const ProjectProcessView = lazy(() =>
  import("./views/ProjectProcessView").then((m) => ({ default: m.ProjectProcessView })),
);
const ProjectStatsView = lazy(() => import("./views/ProjectStatsView").then((m) => ({ default: m.ProjectStatsView })));

function EmptyRoute() {
  return null;
}

function LastAppRedirect() {
  const previousPath = useAppUIStore((s) => s.previousPath);
  const lastAppId = getLastApp();
  return <Navigate to={getInitialShellPath(lastAppId, previousPath)} replace />;
}

/** Keeps AppShell chrome visible while lazy shell routes load (avoids full-app Suspense fallback). */
function ShellOutletSuspense() {
  return (
    <Suspense fallback={null}>
      <Outlet />
    </Suspense>
  );
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
        <Route
          path="ide"
          element={
            <Suspense fallback={null}>
              <IdeView />
            </Suspense>
          }
        />
        <Route element={<RequireAuth />}>
          <Route
            path="invite/:token"
            element={
              <Suspense fallback={null}>
                <InviteAcceptView />
              </Suspense>
            }
          />
          <Route element={<AppShell />}>
            <Route element={<ShellOutletSuspense />}>
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

              <Route path="tasks" element={<ShellRoutePlaceholder title="Tasks" />} />
              <Route path="tasks/:projectId" element={<ShellRoutePlaceholder title="Tasks" />} />
              <Route
                path="tasks/:projectId/agents/:agentInstanceId"
                element={<ShellRoutePlaceholder title="Tasks" />}
              />

              <Route path="process" element={<ProcessIndexRedirect />} />
              <Route path="process/:processId" element={<ShellRoutePlaceholder title="Process" />} />

              <Route path="feed" element={<ShellRoutePlaceholder title="Feed" />} />
              <Route path="profile" element={<ShellRoutePlaceholder title="Profile" />} />
              <Route path="desktop" element={<EmptyRoute />} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
