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
        <StatCard value={progress.total_tasks} label="Total Tasks" />
        <StatCard value={progress.done_tasks} label="Tasks Complete" />
        <StatCard value={progress.in_progress_tasks} label="Tasks Active" />
        <StatCard value={progress.ready_tasks} label="Tasks Ready" />
        <StatCard value={progress.pending_tasks} label="Tasks Pending" />
        <StatCard value={progress.blocked_tasks} label="Tasks Blocked" />
        <StatCard value={progress.failed_tasks} label="Tasks Failed" />
      </div>

      <div style={{ margin: "var(--space-4) 0 var(--space-2)" }}>
        <Text variant="muted" size="xs" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Activity
        </Text>
      </div>

      <div className={styles.statsGrid}>
        <StatCard value={progress.total_tokens} label="Total Tokens" fmt />
        <StatCard value={progress.lines_changed} label="Lines Changed" fmt />
        <StatCard value={progress.lines_of_code} label="Lines of Code" fmt />
        <StatCard value={progress.total_commits} label="Total Commits" fmt />
        <StatCard value={progress.total_pull_requests} label="Pull Requests" fmt />
        <StatCard value={progress.total_messages} label="Total Messages" fmt />
        <StatCard value={progress.total_sessions} label="Total Sessions" fmt />
      </div>
    </div>
  );
}

function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 0 : 1).replace(/\.0$/, "") + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 10_000) return (n / 1_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, "") + "K";
  return n.toLocaleString();
}

function StatCard({ value, label, fmt }: { value: number; label: string; fmt?: boolean }) {
  const display = fmt ? formatCompact(value) : value;
  const title = fmt ? value.toLocaleString() : undefined;
  return (
    <Panel variant="solid" border="solid" style={{ padding: "var(--space-3)", textAlign: "center" }}>
      <div className={styles.statValue} style={{ color: "var(--color-text-secondary)" }} title={title}>{display}</div>
      <Text size="xs" align="center" style={{ color: "var(--color-text-muted)" }}>{label}</Text>
    </Panel>
  );
}
