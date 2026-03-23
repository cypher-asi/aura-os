import { Navigate } from "react-router-dom";
import { PageEmptyState } from "@cypher-asi/zui";
import { Rocket } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { getLastAgent, getLastAgentEntry, getLastProject } from "../../utils/storage";
import { projectAgentChatRoute, projectAgentRoute } from "../../utils/mobileNavigation";
import { useOrgStore } from "../../stores/org-store";
import { getMostRecentProject, useProjectsListStore } from "../../stores/projects-list-store";

export function HomeView() {
  const { isMobileLayout } = useAuraCapabilities();
  const projects = useProjectsListStore((s) => s.projects);
  const { activeOrg, isLoading } = useOrgStore(
    useShallow((s) => ({ activeOrg: s.activeOrg, isLoading: s.isLoading })),
  );
  const mostRecentProject = getMostRecentProject(projects);
  const lastProjectId = getLastProject();
  const lastProject = lastProjectId
    ? projects.find((project) => project.project_id === lastProjectId) ?? null
    : null;
  const lastAgentEntry = getLastAgentEntry();
  const fallbackProject = lastAgentEntry
    ? projects.find((project) => project.project_id === lastAgentEntry.projectId) ?? null
    : null;
  const targetProject = lastProject ?? fallbackProject ?? mostRecentProject ?? projects[0] ?? null;

  if (isMobileLayout && targetProject) {
    const lastAgentId = getLastAgent(targetProject.project_id);
    const targetPath = lastAgentId
      ? projectAgentChatRoute(targetProject.project_id, lastAgentId)
      : projectAgentRoute(targetProject.project_id);
    return <Navigate to={targetPath} replace />;
  }

  return (
    <PageEmptyState
      icon={<Rocket size={32} />}
      title="Welcome to AURA"
      description={
        activeOrg
          ? "Select a project from navigation to get started."
          : isLoading
            ? "Loading your workspace..."
            : "Create or join a team to start your first project."
      }
    />
  );
}
