/* eslint-disable react-refresh/only-export-components -- route modules mix lazy components and route tables by design */
import { lazy } from "react";
import { Navigate, useParams, type RouteObject } from "react-router-dom";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { AgentChatRoute } from "../agents/components/AgentChatRoute";
import { MobileOrganizationView } from "../../mobile/screens/MobileOrganizationView";
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
import { MobileProjectAgentsScreen } from "../../mobile/screens/ProjectAgentsScreen/ProjectAgentsScreen";
import { MobileProjectFilesScreen } from "../../mobile/screens/ProjectFilesScreen/ProjectFilesScreen";
import { MobileProjectProcessScreen } from "../../mobile/screens/ProjectProcessScreen/ProjectProcessScreen";
import { MobileProjectStatsScreen } from "../../mobile/screens/ProjectStatsScreen/ProjectStatsScreen";
import { MobileProjectTasksScreen } from "../../mobile/screens/ProjectTasksScreen/ProjectTasksScreen";
import { MobileProjectWorkScreen } from "../../mobile/screens/ProjectWorkScreen/ProjectWorkScreen";
import { MobileSettingsView } from "../../mobile/screens/MobileSettingsView";
import { projectWorkRoute } from "../../utils/mobileNavigation";

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

function ProjectTasksRoute() {
  const { isMobileLayout } = useAuraCapabilities();
  return isMobileLayout ? <MobileProjectTasksScreen /> : <ProjectTasksView />;
}

function ProjectWorkRoute() {
  const { isMobileLayout } = useAuraCapabilities();
  return isMobileLayout ? <MobileProjectWorkScreen /> : <ProjectWorkView />;
}

function ProjectExecutionRoute() {
  const { projectId } = useParams<{ projectId: string }>();
  const { isMobileLayout } = useAuraCapabilities();
  return isMobileLayout && projectId ? <Navigate to={projectWorkRoute(projectId)} replace /> : <ExecutionView />;
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
      { path: "execution", element: <ProjectExecutionRoute /> },
      { path: "work", element: <ProjectWorkRoute /> },
      { path: "tasks", element: <ProjectTasksRoute /> },
      { path: "files", element: <ProjectFilesRoute /> },
      { path: "process", element: <ProjectProcessRoute /> },
      { path: "stats", element: <ProjectStatsRoute /> },
    ],
  },
];
