import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { ProjectProgress } from "../types";
import { useProjectContext } from "../context/ProjectContext";
import { Page, PageEmptyState, Panel, Text } from "@cypher-asi/zui";
import styles from "./aura.module.css";

export function ProgressDashboard() {
  const ctx = useProjectContext();
  const projectId = ctx?.project.project_id;
  const [progress, setProgress] = useState<ProjectProgress | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    const load = () => {
      api
        .getProgress(projectId)
        .then(setProgress)
        .catch(console.error)
        .finally(() => setLoading(false));
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [projectId]);

  if (!loading && !progress) {
    return <PageEmptyState title="No progress data" />;
  }

  const pct = progress ? Math.round(progress.completion_percentage * 100) / 100 : 0;

  return (
    <Page
      title="Progress"
      subtitle={progress ? `${progress.done_tasks} of ${progress.total_tasks} tasks complete` : undefined}
      isLoading={loading}
    >
      <div style={{ textAlign: "center", marginBottom: "var(--space-5)" }}>
        <div style={{ fontSize: 56, fontWeight: 800, color: "var(--color-accent)" }}>
          {pct}%
        </div>
        <div className={styles.progressBarContainer} style={{ maxWidth: 400, margin: "12px auto" }}>
          <div className={styles.progressBarFill} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {progress && (
        <div className={styles.statsGrid}>
          <StatCard value={progress.total_tasks} label="Total" color="var(--color-text)" />
          <StatCard value={progress.done_tasks} label="Done" color="var(--status-done)" />
          <StatCard value={progress.in_progress_tasks} label="In Progress" color="var(--status-in-progress)" />
          <StatCard value={progress.ready_tasks} label="Ready" color="var(--status-ready)" />
          <StatCard value={progress.pending_tasks} label="Pending" color="var(--status-pending)" />
          <StatCard value={progress.blocked_tasks} label="Blocked" color="var(--status-blocked)" />
          <StatCard value={progress.failed_tasks} label="Failed" color="var(--status-failed)" />
        </div>
      )}
    </Page>
  );
}

function StatCard({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <Panel variant="solid" border="solid" style={{ padding: "var(--space-4)", textAlign: "center" }}>
      <div className={styles.statValue} style={{ color }}>{value}</div>
      <Text variant="muted" size="xs">{label}</Text>
    </Panel>
  );
}
