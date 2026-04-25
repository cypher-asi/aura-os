/* eslint-disable react-refresh/only-export-components -- route modules mix lazy components and route tables by design */
import { lazy } from "react";
import { Navigate, type RouteObject } from "react-router-dom";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { AgentChatView } from "../../components/AgentChatView";
import { MobileOrganizationView } from "../../views/MobileOrganizationView";
import { ExecutionView } from "../../views/ExecutionView";
import { ProjectAgentDetailsView } from "../../views/ProjectAgentDetailsView";
import { ProjectAgentRedirectView } from "../../views/ProjectAgentRedirectView";
import { ProjectAgentSetupView } from "../../views/ProjectAgentSetupView/ProjectAgentSetupView";
import { ProjectAgentsView } from "../../views/ProjectAgentsView";
import { ProjectFilesView } from "../../views/ProjectFilesView";
import { ProjectLayout } from "../../views/ProjectLayout";
import { ProjectProcessView } from "../../views/ProjectProcessView";
import { ProjectRootRedirectView } from "../../views/ProjectRootRedirectView";
import { ProjectStatsView } from "../../views/ProjectStatsView";
import { ProjectTasksView } from "../../views/ProjectTasksView";
import { ProjectWorkView } from "../../views/ProjectWorkView";

const HomeView = lazy(() => import("../../views/HomeView").then((m) => ({ default: m.HomeView })));
const SettingsView = lazy(() => import("../../views/SettingsView").then((m) => ({ default: m.SettingsView })));

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
      { path: "agents", element: <ProjectAgentsView /> },
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
