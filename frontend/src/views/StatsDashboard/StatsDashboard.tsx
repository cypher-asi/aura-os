import { Text } from "@cypher-asi/zui";
import { useDelayedEmpty } from "../../hooks/use-delayed-empty";
import { EmptyState } from "../../components/EmptyState";
import { formatCompact } from "../../utils/format";
import { useStatsDashboardData } from "./useStatsDashboardData";
import styles from "../aura.module.css";

function formatSeconds(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  const mins = Math.floor(s / 60);
  if (mins < 60) return `${mins}m ${Math.round(s % 60)}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

export function StatsDashboard() {
  const { stats, loading } = useStatsDashboardData();

  const showEmpty = useDelayedEmpty(!stats, loading, 0);
  if (!stats) {
    if (!showEmpty) return null;
    return <EmptyState>No project stats available</EmptyState>;
  }

  return (
    <div className={styles.dashboardPadding}>
      {/* Completion */}
      <div className={styles.sectionMargin}>
        <Text variant="muted" size="xs" className={styles.uppercaseLabel}>
          Completion
        </Text>
      </div>
      <div className={styles.completionRow}>
        <div className={styles.progressBarContainer} style={{ flex: 1 }}>
          <div
            className={styles.progressBarFill}
            style={{ width: `${Math.min(stats.completion_percentage, 100)}%` }}
          />
        </div>
        <Text size="xs" className={styles.progressPct}>
          {Math.round(stats.completion_percentage)}%
        </Text>
      </div>

      {/* Tasks */}
      <div className={styles.sectionMarginTop}>
        <Text variant="muted" size="xs" className={styles.uppercaseLabel}>
          Tasks
        </Text>
      </div>
      <div className={styles.statsGrid}>
        <StatCard value={stats.pending_tasks} label="Pending" />
        <StatCard value={stats.ready_tasks} label="Ready" />
        <StatCard value={stats.in_progress_tasks} label="In Progress" />
        <StatCard value={stats.blocked_tasks} label="Blocked" />
        <StatCard value={stats.done_tasks} label="Done" />
        <StatCard value={stats.failed_tasks} label="Failed" />
      </div>

      {/* Overview */}
      <div className={styles.sectionMarginTop}>
        <Text variant="muted" size="xs" className={styles.uppercaseLabel}>
          Overview
        </Text>
      </div>
      <div className={styles.statsGrid}>
        <StatCard value={stats.total_tokens} label="Tokens" fmt />
        <StatCard value={stats.total_events} label="Events" fmt />
        <StatCard value={stats.total_agents} label="Agents" />
        <StatCard value={stats.total_sessions} label="Sessions" />
        <StatCard value={stats.total_time_seconds} label="Time Spent" fmtFn={formatSeconds} />
        <StatCard value={stats.lines_changed} label="Lines Changed" fmt />
        <StatCard value={stats.total_specs} label="Specs" />
        <StatCard value={stats.contributors} label="Contributors" />
      </div>
    </div>
  );
}

function StatCard({
  value,
  label,
  fmt,
  fmtFn,
}: {
  value: number;
  label: string;
  fmt?: boolean;
  fmtFn?: (n: number) => string;
}) {
  const display = fmtFn ? fmtFn(value) : fmt ? formatCompact(value) : value;
  const title = fmtFn || fmt ? value.toLocaleString() : undefined;
  return (
    <div className={styles.statCard}>
      <div className={`${styles.statValue} ${styles.statCardValueColor}`} title={title}>
        {display}
      </div>
      <Text size="xs" align="center" className={styles.statCardLabel}>
        {label}
      </Text>
    </div>
  );
}
