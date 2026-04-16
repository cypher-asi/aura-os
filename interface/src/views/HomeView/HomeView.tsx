import { useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button, PageEmptyState } from "@cypher-asi/zui";
import { Rocket } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { getLastAgent, getLastAgentEntry, getLastProject } from "../../utils/storage";
import { projectAgentChatRoute, projectAgentRoute } from "../../utils/mobileNavigation";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useOrgStore } from "../../stores/org-store";
import { getMostRecentProject, useProjectsListStore } from "../../stores/projects-list-store";
import { useMobileDrawerStore } from "../../stores/mobile-drawer-store";

export function HomeView() {
  const navigate = useNavigate();
  const { projects, loadingProjects, refreshProjects } = useProjectsListStore(
    useShallow((s) => ({
      projects: s.projects,
      loadingProjects: s.loadingProjects,
      refreshProjects: s.refreshProjects,
    })),
  );
  const setAccountOpen = useMobileDrawerStore((s) => s.setAccountOpen);
  const { isMobileLayout } = useAuraCapabilities();
  const { activeOrg, isLoading, orgs } = useOrgStore(
    useShallow((s) => ({ activeOrg: s.activeOrg, isLoading: s.isLoading, orgs: s.orgs })),
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

  useEffect(() => {
    if (!activeOrg || isLoading || loadingProjects || projects.length > 0) {
      return;
    }

    void refreshProjects();
  }, [activeOrg, isLoading, loadingProjects, projects.length, refreshProjects]);

  if (targetProject) {
    const lastAgentId = getLastAgent(targetProject.project_id);
    const targetPath = lastAgentId
      ? projectAgentChatRoute(targetProject.project_id, lastAgentId)
      : projectAgentRoute(targetProject.project_id);
    return <Navigate to={targetPath} replace />;
  }

  if (loadingProjects && projects.length === 0) {
    return null;
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
      actions={isMobileLayout && !activeOrg && !isLoading ? (
        <Button
          variant="secondary"
          onClick={() => {
            if (isMobileLayout) {
              navigate("/projects/organization");
              return;
            }
            setAccountOpen(true);
          }}
        >
          {orgs.length > 0 ? "Choose Team" : "Set Up Team"}
        </Button>
      ) : undefined}
    />
  );
}
