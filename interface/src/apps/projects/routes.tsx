/* eslint-disable react-refresh/only-export-components -- route modules mix lazy components and route tables by design */
import { lazy } from "react";
import { Navigate, type RouteObject } from "react-router-dom";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";

/*
 * Every route element is lazy: this module is statically imported by the
 * app registry (and therefore by App.tsx), so any eager component import
 * here would drag the full authenticated projects UI into the initial
 * bundle that public marketing visitors download. Lazy elements share the
 * shell's outer `<Suspense>` boundary from `App.tsx`.
 */
const AgentChatRoute = lazy(() =>
  import("../agents/components/AgentChatRoute").then((m) => ({
    default: m.AgentChatRoute,
  })),
);
const MobileOrganizationView = lazy(() =>
  import("../../mobile/screens/MobileOrganizationView").then((m) => ({
    default: m.MobileOrganizationView,
  })),
);
const ExecutionView = lazy(() =>
  import("../../views/ExecutionView").then((m) => ({ default: m.ExecutionView })),
);
const ProjectAgentDetailsView = lazy(() =>
  import("../../views/ProjectAgentDetailsView").then((m) => ({
    default: m.ProjectAgentDetailsView,
  })),
);
const ProjectAgentRedirectView = lazy(() =>
  import("../../views/ProjectAgentRedirectView").then((m) => ({
    default: m.ProjectAgentRedirectView,
  })),
);
const ProjectAgentSetupView = lazy(() =>
  import("../../views/ProjectAgentSetupView/ProjectAgentSetupView").then((m) => ({
    default: m.ProjectAgentSetupView,
  })),
);
const ProjectAgentsView = lazy(() =>
  import("../../views/ProjectAgentsView").then((m) => ({
    default: m.ProjectAgentsView,
  })),
);
const ProjectFilesView = lazy(() =>
  import("../../views/ProjectFilesView").then((m) => ({
    default: m.ProjectFilesView,
  })),
);
const ProjectLayout = lazy(() =>
  import("../../views/ProjectLayout").then((m) => ({ default: m.ProjectLayout })),
);
const ProjectProcessView = lazy(() =>
  import("../../views/ProjectProcessView").then((m) => ({
    default: m.ProjectProcessView,
  })),
);
const ProjectRootRedirectView = lazy(() =>
  import("../../views/ProjectRootRedirectView").then((m) => ({
    default: m.ProjectRootRedirectView,
  })),
);
const ProjectStatsView = lazy(() =>
  import("../../views/ProjectStatsView").then((m) => ({
    default: m.ProjectStatsView,
  })),
);
const ProjectTasksView = lazy(() =>
  import("../../views/ProjectTasksView").then((m) => ({
    default: m.ProjectTasksView,
  })),
);
const ProjectWorkView = lazy(() =>
  import("../../views/ProjectWorkView").then((m) => ({
    default: m.ProjectWorkView,
  })),
);
const MobileProjectAgentsScreen = lazy(() =>
  import("../../mobile/screens/ProjectAgentsScreen/ProjectAgentsScreen").then(
    (m) => ({ default: m.MobileProjectAgentsScreen }),
  ),
);
const MobileProjectFilesScreen = lazy(() =>
  import("../../mobile/screens/ProjectFilesScreen/ProjectFilesScreen").then(
    (m) => ({ default: m.MobileProjectFilesScreen }),
  ),
);
const MobileProjectProcessScreen = lazy(() =>
  import("../../mobile/screens/ProjectProcessScreen/ProjectProcessScreen").then(
    (m) => ({ default: m.MobileProjectProcessScreen }),
  ),
);
const MobileProjectStatsScreen = lazy(() =>
  import("../../mobile/screens/ProjectStatsScreen/ProjectStatsScreen").then(
    (m) => ({ default: m.MobileProjectStatsScreen }),
  ),
);
const MobileSettingsView = lazy(() =>
  import("../../mobile/screens/MobileSettingsView").then((m) => ({
    default: m.MobileSettingsView,
  })),
);

const HomeView = lazy(() => import("../../views/HomeView").then((m) => ({ default: m.HomeView })));
const SettingsView = lazy(() => import("../../views/SettingsView").then((m) => ({ default: m.SettingsView })));

function MobileOrganizationRoute() {
  const { isMobileLayout } = useAuraCapabilities();
  return isMobileLayout ? <MobileOrganizationView /> : <Navigate to="/projects" replace />;
}

function ProjectFilesRoute() {
  const { isMobileLayout } = useAuraCapabilities();
  return isMobileLayout ? <MobileProjectFilesScreen /> : <ProjectFilesView />;
}

function ProjectAgentsRoute() {
  const { isMobileLayout } = useAuraCapabilities();
  return isMobileLayout ? <MobileProjectAgentsScreen /> : <ProjectAgentsView />;
}

function ProjectProcessRoute() {
  const { isMobileLayout } = useAuraCapabilities();
  return isMobileLayout ? <MobileProjectProcessScreen /> : <ProjectProcessView />;
}

function ProjectStatsRoute() {
  const { isMobileLayout } = useAuraCapabilities();
  return isMobileLayout ? <MobileProjectStatsScreen /> : <ProjectStatsView />;
}

function SettingsRoute() {
  const { isMobileLayout } = useAuraCapabilities();
  return isMobileLayout ? <MobileSettingsView /> : <SettingsView />;
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
  { path: "projects/settings", element: <SettingsRoute /> },
  { path: "projects/settings/:section", element: <SettingsRoute /> },
  {
    path: "projects/:projectId",
    element: <ProjectLayout />,
    children: [
      { index: true, element: <ProjectRootRedirectView /> },
      { path: "agent", element: <ProjectAgentRedirectView /> },
      { path: "agents", element: <ProjectAgentsRoute /> },
      { path: "agents/create", element: <ProjectAgentSetupView mode="create" /> },
      { path: "agents/attach", element: <ProjectAgentSetupView mode="existing" /> },
      { path: "agents/:agentInstanceId/details", element: <ProjectAgentDetailsView /> },
      { path: "agents/:agentInstanceId", element: <AgentChatRoute /> },
      { path: "execution", element: <ExecutionView /> },
      { path: "work", element: <ProjectWorkView /> },
      { path: "tasks", element: <ProjectTasksView /> },
      { path: "files", element: <ProjectFilesRoute /> },
      { path: "process", element: <ProjectProcessRoute /> },
      { path: "stats", element: <ProjectStatsRoute /> },
    ],
  },
];
