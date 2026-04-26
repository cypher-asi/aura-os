import { Navigate } from "react-router-dom";
import { useProjectActions } from "../../stores/project-action-store";

export function ProjectProcessView() {
  const ctx = useProjectActions();
  const projectId = ctx?.project.project_id;

  if (!projectId) {
    return null;
  }

  return <Navigate to="/process" replace />;
}
