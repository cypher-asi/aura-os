import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { ProjectProgress } from "../types";
import { useProjectContext } from "../context/ProjectContext";
import { useDelayedEmpty } from "../hooks/use-delayed-empty";
import { Text } from "@cypher-asi/zui";
import { EmptyState } from "../components/EmptyState";
import styles from "./aura.module.css";

export function StatsDashboard() {
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

  const showEmpty = useDelayedEmpty(!progress, loading, 0);

  if (!progress) {
    if (!showEmpty) return null;
    return <EmptyState>No stats data</EmptyState>;
  }

  const pct = Math.round(progress.completion_percentage * 100) / 100;

  return (
    <div style={{ padding: "var(--space-3) var(--space-3)" }}>
      <div style={{ textAlign: "center", marginBottom: "var(--space-3)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md, 6px)", padding: "var(--space-3)" }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: "var(--color-text-secondary)", paddingTop: "var(--space-2)", paddingBottom: "var(--space-2)" }}>
          {pct}%
        </div>
        <div className={styles.progressBarContainer}>
          <div className={styles.progressBarFill} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div style={{ margin: "0 0 var(--space-1)" }}>
        <Text variant="muted" size="xs" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Tasks
        </Text>
      </div>

      <div className={styles.statsGrid}>
        <StatCard value={progress.total_tasks} label="Total" />
        <StatCard value={progress.done_tasks} label="Complete" />
        <StatCard value={progress.in_progress_tasks} label="Active" />
        <StatCard value={progress.ready_tasks} label="Ready" />
        <StatCard value={progress.pending_tasks} label="Pending" />
        <StatCard value={progress.blocked_tasks} label="Blocked" />
        <StatCard value={progress.failed_tasks} label="Failed" />
      </div>

      <div style={{ margin: "var(--space-2) 0 var(--space-1)" }}>
        <Text variant="muted" size="xs" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Activity
        </Text>
      </div>

      <div className={styles.statsGrid}>
        <StatCard value={progress.total_cost} label="Cost" fmtFn={formatCurrency} />
        <StatCard value={progress.total_tokens} label="Tokens" fmt />
        <StatCard value={progress.lines_changed} label="Changed" fmt />
        <StatCard value={progress.lines_of_code} label="LoC" fmt />
        <StatCard value={progress.total_commits} label="Commits" fmt />
        <StatCard value={progress.total_pull_requests} label="PRs" fmt />
        <StatCard value={progress.total_messages} label="Messages" fmt />
        <StatCard value={progress.total_agents} label="Agents" fmt />
        <StatCard value={progress.total_sessions} label="Sessions" fmt />
        <StatCard value={progress.total_tests} label="Tests" fmt />
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

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  if (n >= 1) return "$" + n.toFixed(2);
  if (n > 0) return "$" + n.toFixed(2);
  return "$0.00";
}

function StatCard({ value, label, fmt, fmtFn }: { value: number; label: string; fmt?: boolean; fmtFn?: (n: number) => string }) {
  const display = fmtFn ? fmtFn(value) : fmt ? formatCompact(value) : value;
  const title = (fmtFn || fmt) ? value.toLocaleString() : undefined;
  return (
    <div style={{ padding: "var(--space-1) var(--space-2)", textAlign: "center", height: 64, display: "flex", flexDirection: "column", justifyContent: "center", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md, 6px)" }}>
      <div className={styles.statValue} style={{ color: "var(--color-text-secondary)" }} title={title}>{display}</div>
      <Text size="xs" align="center" style={{ color: "var(--color-text-muted)", fontSize: 10 }}>{label}</Text>
    </div>
  );
}
