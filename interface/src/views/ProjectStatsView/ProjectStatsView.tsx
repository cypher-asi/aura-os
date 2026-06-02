import { useProjectActions } from "../../stores/project-action-store";
import { StatsDashboard } from "../StatsDashboard";

export function ProjectStatsView() {
  const ctx = useProjectActions();

  if (!ctx?.project.project_id) {
    return null;
  }

  return (
    <div
      data-agent-surface="project-stats-view"
      data-agent-proof="project-stats-dashboard-populated"
      data-agent-context-anchor="project-stats-view"
    >
      <StatsDashboard />
    </div>
  );
}
