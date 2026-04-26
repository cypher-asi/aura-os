import { useProjectActions } from "../../../stores/project-action-store";
import { StatsDashboard } from "../../../views/StatsDashboard";
import styles from "./ProjectStatsScreen.module.css";

export function MobileProjectStatsScreen() {
  const ctx = useProjectActions();

  if (!ctx?.project.project_id) {
    return null;
  }

  return (
    <div className={styles.root}>
      <h1 className={styles.screenTitle}>Stats</h1>
      <StatsDashboard variant="mobile" />
    </div>
  );
}
