import { Navigate } from "react-router-dom";
import { PageEmptyState } from "@cypher-asi/zui";
import { Rocket } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { getLastAgent } from "../../utils/storage";
import { projectAgentRoute } from "../../utils/mobileNavigation";
import { useOrgStore } from "../../stores/org-store";
import { getMostRecentProject, useProjectsListStore } from "../../stores/projects-list-store";

export function HomeView() {
  const { isMobileLayout } = useAuraCapabilities();
  const projects = useProjectsListStore((s) => s.projects);
  const { activeOrg, isLoading } = useOrgStore(
    useShallow((s) => ({ activeOrg: s.activeOrg, isLoading: s.isLoading })),
  );
  const mostRecentProject = getMostRecentProject(projects);

  const lastAgent = getLastAgent();
  const targetProject = (
    lastAgent
      ? projects.find((project) => project.project_id === lastAgent.projectId)
      : null
  ) ?? mostRecentProject ?? projects[0] ?? null;

  if (isMobileLayout && targetProject) {
    return <Navigate to={projectAgentRoute(targetProject.project_id)} replace />;
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
