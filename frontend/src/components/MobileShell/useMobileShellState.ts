import { useLocation } from "react-router-dom";
import { useAppStore } from "../../stores/app-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useProjectContext } from "../../stores/project-action-store";
import { getMostRecentProject, useProjectsListStore } from "../../stores/projects-list-store";
import { getLastAgentEntry } from "../../utils/storage";
import {
  getMobileProjectDestination,
  getMobileShellMode,
  getProjectIdFromPathname,
  isProjectSubroute,
  projectRootPath,
} from "../../utils/mobileNavigation";

export function useMobileShellState() {
  const activeApp = useAppStore((s) => s.activeApp);
  const { isPhoneLayout } = useAuraCapabilities();
  const projectContext = useProjectContext();
  const location = useLocation();
  const projects = useProjectsListStore((s) => s.projects);
  const mostRecentProject = getMostRecentProject(projects);

  const currentProjectId = getProjectIdFromPathname(location.pathname);
  const currentProject = projectContext?.project
    ?? projects.find((project) => project.project_id === currentProjectId)
    ?? null;
  const mobileDestination = getMobileProjectDestination(location.pathname);

  const lastAgent = getLastAgentEntry();
  const recentProjectId = lastAgent && projects.some((project) => project.project_id === lastAgent.projectId)
    ? lastAgent.projectId
    : mostRecentProject?.project_id ?? projects[0]?.project_id ?? null;
  const mobileTargetProjectId = currentProjectId ?? recentProjectId;
  const mobileTargetProject = projects.find((project) => project.project_id === mobileTargetProjectId) ?? null;

  const hasResolvedCurrentProject = Boolean(currentProject);
  const currentProjectRootPath = currentProjectId ? projectRootPath(currentProjectId) : null;
  const isProjectRoute = Boolean(currentProjectId) && (
    location.pathname === currentProjectRootPath || isProjectSubroute(location.pathname, currentProjectId)
  );

  const mobileShellMode = getMobileShellMode(location.pathname, currentProjectId, hasResolvedCurrentProject);
  const isPrimaryProjectDestination = mobileDestination === "agent" || mobileDestination === "tasks" || mobileDestination === "files";
  const showProjectTitle = mobileShellMode === "project" && hasResolvedCurrentProject && Boolean(currentProjectId) && isProjectRoute;
  const showProjectBack = hasResolvedCurrentProject && Boolean(currentProjectId) && isProjectRoute && location.pathname !== currentProjectRootPath && !isPrimaryProjectDestination;
  const showProjectResponsiveControls = activeApp.id !== "projects";
  const showGlobalTitle = mobileShellMode === "global";
  const globalTitle = location.pathname === "/projects" ? "Projects" : activeApp.label;

  return {
    activeApp, isPhoneLayout, location,
    currentProjectId, currentProject, mobileDestination,
    mobileTargetProjectId, mobileTargetProject,
    showProjectTitle, showProjectBack, showProjectResponsiveControls,
    showGlobalTitle, globalTitle,
  };
}
