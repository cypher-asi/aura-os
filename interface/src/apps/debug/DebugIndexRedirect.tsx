import { Loader2 } from "lucide-react";
import { Navigate } from "react-router-dom";
import { PageEmptyState } from "@cypher-asi/zui";
import { useProjectsListStore } from "../../stores/projects-list-store";
import {
  clearLastDebugProject,
  clearLastDebugRunIf,
  getLastDebugProject,
  getLastDebugRun,
} from "../../utils/storage";
import { DebugEmptyView } from "./DebugMainPanel";

/**
 * Route target for the bare `/debug` path. Mirrors
 * `ProcessIndexRedirect` so returning to the Debug app lands on the
 * project (and run) the user was last inspecting. Falls back to the
 * normal empty view when nothing is remembered or the remembered
 * project no longer exists.
 */
export function DebugIndexRedirect() {
  const projects = useProjectsListStore((s) => s.projects);
  const loading = useProjectsListStore((s) => s.loadingProjects);

  if (loading && projects.length === 0) {
    return (
      <PageEmptyState
        icon={<Loader2 size={32} className="animate-spin" aria-hidden />}
        title="Loading projects..."
      />
    );
  }

  const lastProjectId = getLastDebugProject();
  const lastProject = lastProjectId
    ? projects.find((p) => p.project_id === lastProjectId)
    : null;

  if (!lastProject) {
    if (lastProjectId) {
      clearLastDebugProject();
      clearLastDebugRunIf({ projectId: lastProjectId });
    }
    return <DebugEmptyView />;
  }

  const lastRunId = getLastDebugRun(lastProject.project_id);
  const target = lastRunId
    ? `/debug/${lastProject.project_id}/runs/${lastRunId}`
    : `/debug/${lastProject.project_id}`;
  return <Navigate to={target} replace />;
}
