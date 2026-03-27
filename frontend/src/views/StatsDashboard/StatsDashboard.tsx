import { Text } from "@cypher-asi/zui";
import { useDelayedEmpty } from "../../hooks/use-delayed-empty";
import { EmptyState } from "../../components/EmptyState";
import { formatCompact } from "../../utils/format";
import { useStatsDashboardData } from "./useStatsDashboardData";
import styles from "../aura.module.css";
import mobileStyles from "./StatsDashboard.module.css";

function formatCost(usd: number): string {
  if (usd < 0.01) return "$0";
  if (usd < 1) return `$${usd.toFixed(2)}`;
  if (usd < 100) return `$${usd.toFixed(1)}`;
  return `$${Math.round(usd)}`;
}

function formatSeconds(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  const mins = Math.floor(s / 60);
  if (mins < 60) return `${mins}m ${Math.round(s % 60)}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

interface StatsDashboardProps {
  variant?: "sidekick" | "mobile";
}

function cx(...classNames: Array<string | false | null | undefined>): string {
  return classNames.filter(Boolean).join(" ");
}

export function StatsDashboard({ variant = "sidekick" }: StatsDashboardProps) {
  const { stats, loading } = useStatsDashboardData();
  const isMobile = variant === "mobile";

  const showEmpty = useDelayedEmpty(!stats, loading, 0);
  if (!stats) {
    if (!showEmpty) return null;
    return <EmptyState>No project stats available</EmptyState>;
  }

  return (
    <div className={cx(styles.dashboardPadding, isMobile && mobileStyles.mobileDashboard)}>
      {/* Completion */}
      <div className={cx(styles.sectionMargin, isMobile && mobileStyles.mobileSectionMargin)}>
        <Text
          variant="muted"
          size="xs"
          className={cx(styles.uppercaseLabel, isMobile && mobileStyles.mobileSectionLabel)}
        >
          Completion
        </Text>
      </div>
      <div className={cx(styles.completionRow, isMobile && mobileStyles.mobileCompletionRow)}>
        <div
          className={cx(styles.progressBarContainer, isMobile && mobileStyles.mobileProgressBarContainer)}
          style={{ flex: 1 }}
        >
          <div
            className={cx(styles.progressBarFill, isMobile && mobileStyles.mobileProgressBarFill)}
            style={{ width: `${Math.min(stats.completion_percentage, 100)}%` }}
          />
        </div>
        <Text size="xs" className={cx(styles.progressPct, isMobile && mobileStyles.mobileProgressPct)}>
          {Math.round(stats.completion_percentage)}%
        </Text>
      </div>

      {/* Tasks */}
      <div className={cx(styles.sectionMarginTop, isMobile && mobileStyles.mobileSectionMarginTop)}>
        <Text
          variant="muted"
          size="xs"
          className={cx(styles.uppercaseLabel, isMobile && mobileStyles.mobileSectionLabel)}
        >
          Tasks
        </Text>
      </div>
      <div className={cx(styles.statsGrid, isMobile && mobileStyles.mobileStatsGrid)}>
        <StatCard value={stats.total_tasks} label="Total" variant={variant} />
        <StatCard value={stats.pending_tasks} label="Pending" variant={variant} />
        <StatCard value={stats.ready_tasks} label="Ready" variant={variant} />
        <StatCard value={stats.in_progress_tasks} label="Active" variant={variant} />
        <StatCard value={stats.blocked_tasks} label="Blocked" variant={variant} />
        <StatCard value={stats.done_tasks} label="Done" variant={variant} />
        <StatCard value={stats.failed_tasks} label="Failed" variant={variant} />
      </div>

      {/* Overview */}
      <div className={cx(styles.sectionMarginTop, isMobile && mobileStyles.mobileSectionMarginTop)}>
        <Text
          variant="muted"
          size="xs"
          className={cx(styles.uppercaseLabel, isMobile && mobileStyles.mobileSectionLabel)}
        >
          Code
        </Text>
      </div>
      <div className={cx(styles.statsGrid, isMobile && mobileStyles.mobileStatsGrid)}>
        <StatCard value={stats.estimated_cost_usd} label="Cost" fmtFn={formatCost} variant={variant} />
        <StatCard value={stats.total_tokens} label="Tokens" fmt variant={variant} />
        <StatCard value={stats.total_events} label="Events" fmt variant={variant} />
        <StatCard value={stats.total_agents} label="Agents" variant={variant} />
        <StatCard value={stats.total_sessions} label="Sessions" variant={variant} />
        <StatCard value={stats.total_time_seconds} label="Time" fmtFn={formatSeconds} variant={variant} />
        <StatCard value={stats.lines_changed} label="Lines" fmt variant={variant} />
        <StatCard value={stats.total_specs} label="Specs" variant={variant} />
        <StatCard value={stats.contributors} label="Coders" variant={variant} />
      </div>
    </div>
  );
}

function StatCard({
  value,
  label,
  fmt,
  fmtFn,
  variant,
}: {
  value: number | undefined;
  label: string;
  fmt?: boolean;
  fmtFn?: (n: number) => string;
  variant: "sidekick" | "mobile";
}) {
  const isMobile = variant === "mobile";
  const safeValue = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const display = fmtFn ? fmtFn(safeValue) : fmt ? formatCompact(safeValue) : safeValue;
  const title = fmtFn || fmt ? safeValue.toLocaleString() : undefined;
  return (
    <div className={cx(styles.statCard, isMobile && mobileStyles.mobileStatCard)}>
      <div
        className={cx(
          styles.statValue,
          styles.statCardValueColor,
          isMobile && mobileStyles.mobileStatValue,
        )}
        title={title}
      >
        {display}
      </div>
      <Text
        size="xs"
        align="center"
        className={cx(styles.statCardLabel, isMobile && mobileStyles.mobileStatLabel)}
      >
        {label}
      </Text>
    </div>
  );
}
