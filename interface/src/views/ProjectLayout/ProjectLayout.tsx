import { useEffect, useRef } from "react";
import { Loader2, FolderGit2, SearchX } from "lucide-react";
import { Outlet, useNavigate, useParams } from "react-router-dom";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { EmptyState } from "../../components/EmptyState";
import { PageEmptyState, Button } from "@cypher-asi/zui";
import { useDelayedLoading } from "../../hooks/use-delayed-loading";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useOrgStore } from "../../stores/org-store";
import { useProjectLayoutData } from "./useProjectLayoutData";

export function ProjectLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { displayProject, loading, loadingProjects, projects } = useProjectLayoutData();
  const { isMobileLayout } = useAuraCapabilities();
  const activeOrgId = useOrgStore((s) => s.activeOrg?.org_id ?? null);
  const showSpinner = useDelayedLoading(loading && !displayProject);
  const previousOrgIdRef = useRef<string | null>(activeOrgId);
  const pendingOrgRecoveryRef = useRef(false);

  useEffect(() => {
    if (previousOrgIdRef.current !== activeOrgId) {
      previousOrgIdRef.current = activeOrgId;
      pendingOrgRecoveryRef.current = true;
    }
  }, [activeOrgId]);

  useEffect(() => {
    if (!pendingOrgRecoveryRef.current || loading || loadingProjects || !activeOrgId) {
      return;
    }

    pendingOrgRecoveryRef.current = false;

    const hasProjectInActiveOrg = projectId ? projects.some((project) => project.project_id === projectId) : false;
    if (!hasProjectInActiveOrg) {
      navigate("/projects", { replace: true });
    }
  }, [activeOrgId, loading, loadingProjects, navigate, projectId, projects]);

  useEffect(() => {
    if (!isMobileLayout || loading || loadingProjects || displayProject || projects.length === 0) {
      return;
    }

    navigate("/projects", { replace: true });
  }, [displayProject, isMobileLayout, loading, loadingProjects, navigate, projects.length]);

  if (showSpinner) {
    return (
      <EmptyState>
        <Loader2 size={20} className="spin" />
      </EmptyState>
    );
  }
  if (!displayProject) {
    if (projects.length === 0) {
      return (
        <PageEmptyState
          icon={<FolderGit2 size={32} />}
          title="No project selected"
          description="Create a project to get started."
        />
      );
    }

    return (
      <PageEmptyState
        icon={<SearchX size={32} />}
        title="Project not found"
        description="Choose a project from navigation to continue."
        actions={
          <Button variant="secondary" onClick={() => navigate("/projects")}>
            Back to Projects
          </Button>
        }
      />
    );
  }

  return (
    <ErrorBoundary name="project-view">
      <Outlet />
    </ErrorBoundary>
  );
}
