import { Navigate, useParams } from "react-router-dom";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { projectAgentRoute } from "../../utils/mobileNavigation";
import { ProjectEmptyView } from "../ProjectEmptyView";

export function ProjectRootRedirectView() {
  const { projectId } = useParams<{ projectId: string }>();
  const { isMobileLayout } = useAuraCapabilities();
  const { agentsByProject, loadingAgentsByProject } = useProjectsListStore((state) => ({
    agentsByProject: state.agentsByProject,
    loadingAgentsByProject: state.loadingAgentsByProject,
  }));

  if (isMobileLayout && projectId) {
    return <Navigate to={projectAgentRoute(projectId)} replace />;
  }

  if (projectId) {
    const hasResolvedAgents = projectId in agentsByProject;
    const loadingAgents = loadingAgentsByProject[projectId] === true;
    if (!hasResolvedAgents || loadingAgents) {
      return null;
    }
  }

  return <ProjectEmptyView />;
}
