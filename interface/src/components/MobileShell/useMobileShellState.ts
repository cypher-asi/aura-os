import { useLocation } from "react-router-dom";
import { useActiveApp } from "../../hooks/use-active-app";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useProjectActions } from "../../stores/project-action-store";
import { getMostRecentProject, useProjectsListStore } from "../../stores/projects-list-store";
import { getLastAgentEntry, getLastProject } from "../../utils/storage";
import {
  getMobileProjectDestination,
  getMobileShellMode,
  getProjectIdFromPathname,
  isProjectSubroute,
  projectRootPath,
} from "../../utils/mobileNavigation";

export function useMobileShellState() {
  const activeApp = useActiveApp();
  const { isMobileClient, isPhoneLayout } = useAuraCapabilities();
  const projectContext = useProjectActions();
  const projects = useProjectsListStore((s) => s.projects);
  const location = useLocation();
  const mostRecentProject = getMostRecentProject(projects);

  const currentProjectId = getProjectIdFromPathname(location.pathname);
  const currentProject = projectContext?.project
    ?? projects.find((p) => p.project_id === currentProjectId)
    ?? null;
  const mobileDestination = getMobileProjectDestination(location.pathname);

  const lastProjectId = getLastProject();
  const storedProjectId = lastProjectId && projects.some((project) => project.project_id === lastProjectId)
    ? lastProjectId
    : null;
  const lastAgent = getLastAgentEntry();
  const recentProjectId = lastAgent && projects.some((p) => p.project_id === lastAgent.projectId)
    ? lastAgent.projectId
    : mostRecentProject?.project_id ?? projects[0]?.project_id ?? null;
  const mobileTargetProjectId = currentProjectId ?? storedProjectId ?? recentProjectId;
  const mobileTargetProject = projects.find((project) => project.project_id === mobileTargetProjectId) ?? null;

  const hasResolvedCurrentProject = Boolean(currentProject);
  const currentProjectRootPath = currentProjectId ? projectRootPath(currentProjectId) : null;
  const isProjectRoute = Boolean(currentProjectId) && (
    location.pathname === currentProjectRootPath || isProjectSubroute(location.pathname, currentProjectId)
  );

  const mobileShellMode = getMobileShellMode(location.pathname, currentProjectId, hasResolvedCurrentProject);
  const isProjectAgentManagementRoute =
    /^\/projects\/[^/]+\/agents\/[^/]+\/details$/.test(location.pathname)
    || /^\/projects\/[^/]+\/agents\/create$/.test(location.pathname)
    || /^\/projects\/[^/]+\/agents\/attach$/.test(location.pathname);
  const isPrimaryProjectDestination =
    mobileDestination === "agent"
    || mobileDestination === "execution"
    || mobileDestination === "tasks"
    || mobileDestination === "files"
    || mobileDestination === "process"
    || mobileDestination === "stats";
  const showProjectTitle = mobileShellMode === "project" && hasResolvedCurrentProject && Boolean(currentProjectId) && isProjectRoute;
  const showProjectBack =
    hasResolvedCurrentProject
    && Boolean(currentProjectId)
    && isProjectRoute
    && location.pathname !== currentProjectRootPath
    && (isProjectAgentManagementRoute || !isPrimaryProjectDestination);
  const isStandaloneAgentLibraryRoot = activeApp.id === "agents" && location.pathname === "/agents";
  const isStandaloneAgentDetailRoute = activeApp.id === "agents" && /^\/agents\/[^/]+$/.test(location.pathname);
  const isMobileOrganizationRoute = location.pathname === "/projects/organization";
  const showProjectResponsiveControls = activeApp.id === "agents" && location.pathname.startsWith("/projects/");
  const isProjectAgentChatRoute = /^\/projects\/[^/]+\/agents\/(?!create$|attach$)[^/]+$/.test(location.pathname);
  const showGlobalTitle = mobileShellMode === "global";
  const globalTitle = isMobileOrganizationRoute
    ? "Workspace"
    : location.pathname === "/projects"
      ? "Projects"
      : activeApp.label;

  return {
    activeApp, isMobileClient, isPhoneLayout, location,
    currentProjectId, currentProject, mobileDestination,
    mobileTargetProjectId, mobileTargetProject,
    showProjectTitle, showProjectBack, showProjectResponsiveControls,
    isStandaloneAgentLibraryRoot, isStandaloneAgentDetailRoute,
    isMobileOrganizationRoute,
    isProjectAgentChatRoute, isProjectAgentManagementRoute,
    showGlobalTitle, globalTitle,
  };
}

export type MobileShellState = ReturnType<typeof useMobileShellState>;
