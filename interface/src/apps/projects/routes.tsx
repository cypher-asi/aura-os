/* eslint-disable react-refresh/only-export-components -- route modules mix lazy components and route tables by design */
import { lazy } from "react";
import { Navigate, type RouteObject } from "react-router-dom";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { MobileOrganizationView } from "../../views/MobileOrganizationView";

const HomeView = lazy(() => import("../../views/HomeView").then((m) => ({ default: m.HomeView })));
const SettingsView = lazy(() => import("../../views/SettingsView").then((m) => ({ default: m.SettingsView })));
const ProjectLayout = lazy(() =>
  import("../../views/ProjectLayout").then((m) => ({ default: m.ProjectLayout })),
);
const ProjectRootRedirectView = lazy(() =>
  import("../../views/ProjectRootRedirectView").then((m) => ({ default: m.ProjectRootRedirectView })),
);
const ProjectAgentRedirectView = lazy(() =>
  import("../../views/ProjectAgentRedirectView").then((m) => ({ default: m.ProjectAgentRedirectView })),
);
const ProjectAgentSetupView = lazy(() =>
  import("../../views/ProjectAgentSetupView/ProjectAgentSetupView").then((m) => ({
    default: m.ProjectAgentSetupView,
  })),
);
const ProjectAgentDetailsView = lazy(() =>
  import("../../views/ProjectAgentDetailsView").then((m) => ({ default: m.ProjectAgentDetailsView })),
);
const AgentChatView = lazy(() =>
  import("../../components/AgentChatView").then((m) => ({ default: m.AgentChatView })),
);
const ExecutionView = lazy(() => import("../../views/ExecutionView").then((m) => ({ default: m.ExecutionView })));
const ProjectWorkView = lazy(() =>
  import("../../views/ProjectWorkView").then((m) => ({ default: m.ProjectWorkView })),
);
const ProjectTasksView = lazy(() =>
  import("../../views/ProjectTasksView").then((m) => ({ default: m.ProjectTasksView })),
);
const ProjectFilesView = lazy(() =>
  import("../../views/ProjectFilesView").then((m) => ({ default: m.ProjectFilesView })),
);
const ProjectProcessView = lazy(() =>
  import("../../views/ProjectProcessView").then((m) => ({ default: m.ProjectProcessView })),
);
const ProjectStatsView = lazy(() =>
  import("../../views/ProjectStatsView").then((m) => ({ default: m.ProjectStatsView })),
);

function MobileOrganizationRoute() {
  const { isMobileLayout } = useAuraCapabilities();
  return isMobileLayout ? <MobileOrganizationView /> : <Navigate to="/projects" replace />;
}

/**
 * Routes owned by the Projects app. The `/projects/:projectId` subtree is a
 * nested `ProjectLayout` that renders its own `<Outlet />`, so per-view code
 * (tasks, execution, process, etc.) still lives alongside the layout. Lazy
 * elements share the shell's outer `<Suspense>` boundary from `App.tsx`.
 */
export const projectsRoutes: RouteObject[] = [
  { path: "projects", element: <HomeView /> },
  { path: "projects/organization", element: <MobileOrganizationRoute /> },
  { path: "projects/settings", element: <SettingsView /> },
  {
    path: "projects/:projectId",
    element: <ProjectLayout />,
    children: [
      { index: true, element: <ProjectRootRedirectView /> },
      { path: "agent", element: <ProjectAgentRedirectView /> },
      { path: "agents/create", element: <ProjectAgentSetupView mode="create" /> },
      { path: "agents/attach", element: <ProjectAgentSetupView mode="existing" /> },
      { path: "agents/:agentInstanceId/details", element: <ProjectAgentDetailsView /> },
      { path: "agents/:agentInstanceId", element: <AgentChatView /> },
      { path: "execution", element: <ExecutionView /> },
      { path: "work", element: <ProjectWorkView /> },
      { path: "tasks", element: <ProjectTasksView /> },
      { path: "files", element: <ProjectFilesView /> },
      { path: "process", element: <ProjectProcessView /> },
      { path: "stats", element: <ProjectStatsView /> },
    ],
  },
];
