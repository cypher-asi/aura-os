import { useProjectContext } from "../../stores/project-action-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { StatsDashboard } from "../StatsDashboard";
import styles from "./ProjectStatsView.module.css";

export function ProjectStatsView() {
  const ctx = useProjectContext();
  const { isMobileLayout } = useAuraCapabilities();

  if (!ctx?.project.project_id) {
    return null;
  }

  if (!isMobileLayout) {
    return <StatsDashboard />;
  }

  return (
    <div className={styles.root}>
      <section className={styles.section}>
        <div className={styles.sectionLabel}>Stats</div>
        <StatsDashboard variant="mobile" />
      </section>
    </div>
  );
}
