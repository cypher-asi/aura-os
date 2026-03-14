import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { ProjectProgress } from "../types";
import { useProjectContext } from "../context/ProjectContext";
import { useDelayedEmpty } from "../hooks/use-delayed-empty";
import { PageEmptyState, Panel, Text } from "@cypher-asi/zui";
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

  const showEmpty = useDelayedEmpty(!progress, loading);

  if (!progress) {
    if (!showEmpty) return null;
    return <PageEmptyState title="No progress data" />;
  }

  const pct = Math.round(progress.completion_percentage * 100) / 100;

  return (
    <div style={{ padding: "var(--space-4)" }}>
      <div style={{ textAlign: "center", marginBottom: "var(--space-5)" }}>
        <div style={{ fontSize: 56, fontWeight: 800, color: "var(--color-accent)" }}>
          {pct}%
        </div>
        <div className={styles.progressBarContainer}>
          <div className={styles.progressBarFill} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className={styles.statsGrid}>
        <StatCard value={progress.total_tasks} label="Total Tasks" color="var(--color-text)" />
        <StatCard value={progress.done_tasks} label="Tasks Complete" color="var(--status-done)" />
        <StatCard value={progress.in_progress_tasks} label="Tasks Active" color="var(--status-in-progress)" />
        <StatCard value={progress.ready_tasks} label="Tasks Ready" color="var(--status-ready)" />
        <StatCard value={progress.pending_tasks} label="Tasks Pending" color="var(--status-pending)" />
        <StatCard value={progress.blocked_tasks} label="Tasks Blocked" color="var(--status-blocked)" />
        <StatCard value={progress.failed_tasks} label="Tasks Failed" color="var(--status-failed)" />
      </div>

      <div style={{ margin: "var(--space-4) 0 var(--space-2)" }}>
        <Text variant="muted" size="xs" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Activity
        </Text>
      </div>

      <div className={styles.statsGrid}>
        <StatCard value={progress.total_tokens} label="Total Tokens" color="var(--color-text-muted)" fmt />
        <StatCard value={progress.lines_changed} label="Lines Changed" color="var(--color-text-muted)" fmt />
        <StatCard value={progress.lines_of_code} label="Lines of Code" color="var(--color-text-muted)" fmt />
        <StatCard value={progress.total_commits} label="Total Commits" color="var(--color-text-muted)" fmt />
        <StatCard value={progress.total_pull_requests} label="Pull Requests" color="var(--color-text-muted)" fmt />
        <StatCard value={progress.total_messages} label="Total Messages" color="var(--color-text-muted)" fmt />
        <StatCard value={progress.total_sessions} label="Total Sessions" color="var(--color-text-muted)" fmt />
      </div>
    </div>
  );
}

function StatCard({ value, label, color, fmt }: { value: number; label: string; color: string; fmt?: boolean }) {
  const display = fmt ? value.toLocaleString() : value;
  return (
    <Panel variant="solid" border="solid" style={{ padding: "var(--space-3)", textAlign: "center" }}>
      <div className={styles.statValue} style={{ color }}>{display}</div>
      <Text variant="muted" size="xs">{label}</Text>
    </Panel>
  );
}
