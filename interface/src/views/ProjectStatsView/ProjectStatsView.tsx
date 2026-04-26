import { useProjectActions } from "../../stores/project-action-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { StatsDashboard } from "../StatsDashboard";
import styles from "./ProjectStatsView.module.css";

export function ProjectStatsView() {
  const ctx = useProjectActions();
  const { isMobileLayout } = useAuraCapabilities();

  if (!ctx?.project.project_id) {
    return null;
  }

  if (!isMobileLayout) {
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

  return (
    <div
      className={styles.root}
      data-agent-surface="project-stats-view"
      data-agent-proof="project-stats-dashboard-populated"
      data-agent-context-anchor="project-stats-view"
    >
      <section className={styles.section}>
        <div className={styles.sectionLabel}>STATS</div>
        <StatsDashboard variant="mobile" />
      </section>
    </div>
  );
}
