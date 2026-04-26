import { useDelayedEmpty } from "../../shared/hooks/use-delayed-empty";
import { EmptyState } from "../../components/EmptyState";
import {
  StatCard,
  SectionHeader,
  StatsGrid,
  ProgressBar,
  cx,
  formatCardCost,
  formatSeconds,
} from "../../components/StatCard";
import { useStatsDashboardData } from "./useStatsDashboardData";
import { formatCompact } from "../../shared/utils/format";
import styles from "../aura.module.css";
import mobileStyles from "./StatsDashboard.module.css";

interface StatsDashboardProps {
  variant?: "sidekick" | "mobile";
}

export function StatsDashboard({ variant = "sidekick" }: StatsDashboardProps) {
  const { stats, loading } = useStatsDashboardData();
  const isMobile = variant === "mobile";

  const showEmpty = useDelayedEmpty(!stats, loading, 0);
  if (!stats) {
    if (!showEmpty) return null;
    return <EmptyState>No project stats available</EmptyState>;
  }

  if (isMobile) {
    const taskRows = [
      { label: "Ready", value: stats.ready_tasks },
      { label: "Active", value: stats.in_progress_tasks },
      { label: "Blocked", value: stats.blocked_tasks },
      { label: "Done", value: stats.done_tasks },
      { label: "Failed", value: stats.failed_tasks },
    ];
    const activityRows = [
      { label: "Tokens", value: formatCompact(stats.total_tokens ?? 0) },
      { label: "Cost", value: formatCardCost(stats.estimated_cost_usd ?? 0) },
      { label: "Events", value: formatCompact(stats.total_events ?? 0) },
      { label: "Time", value: formatSeconds(stats.total_time_seconds ?? 0) },
      { label: "Lines", value: formatCompact(stats.lines_changed ?? 0) },
      { label: "Specs", value: String(stats.total_specs ?? 0) },
    ];

    return (
      <div className={mobileStyles.mobileDashboard}>
        <section className={mobileStyles.mobileHero} aria-label="Completion">
          <div>
            <span className={mobileStyles.mobileHeroLabel}>Completion</span>
            <strong className={mobileStyles.mobileHeroValue}>{Math.round(stats.completion_percentage)}%</strong>
          </div>
          <div className={mobileStyles.mobileHeroProgress} aria-hidden="true">
            <span style={{ width: `${Math.min(stats.completion_percentage, 100)}%` }} />
          </div>
        </section>

        <section className={mobileStyles.mobileSummaryGrid} aria-label="Project summary">
          <MobileMetric value={stats.total_tasks} label="Tasks" />
          <MobileMetric value={stats.total_agents} label="Agents" />
          <MobileMetric value={stats.total_sessions} label="Sessions" />
          <MobileMetric value={stats.contributors} label="Coders" />
        </section>

        <MobileList title="Task flow" rows={taskRows.map((row) => ({
          label: row.label,
          value: String(row.value ?? 0),
        }))} />

        <MobileList title="Activity" rows={activityRows} />
      </div>
    );
  }

  return (
    <div
      className={cx(styles.dashboardPadding, isMobile && mobileStyles.mobileDashboard)}
      data-agent-surface="project-stats-dashboard"
      data-agent-context-anchor="project-stats-dashboard"
    >
      <SectionHeader first variant={variant}>Completion</SectionHeader>
      <ProgressBar percentage={stats.completion_percentage} variant={variant} />

      <SectionHeader variant={variant}>Tasks</SectionHeader>
      <StatsGrid variant={variant}>
        <StatCard value={stats.total_tasks} label="Total" variant={variant} />
        <StatCard value={stats.pending_tasks} label="Pending" variant={variant} />
        <StatCard value={stats.ready_tasks} label="Ready" variant={variant} />
        <StatCard value={stats.in_progress_tasks} label="Active" variant={variant} accent="success" />
        <StatCard value={stats.blocked_tasks} label="Blocked" variant={variant} />
        <StatCard value={stats.done_tasks} label="Done" variant={variant} />
        <StatCard value={stats.failed_tasks} label="Failed" variant={variant} />
      </StatsGrid>

      <SectionHeader variant={variant}>Code</SectionHeader>
      <StatsGrid variant={variant}>
        <StatCard value={stats.estimated_cost_usd} label="Cost" fmtFn={formatCardCost} variant={variant} />
        <StatCard value={stats.total_tokens} label="Tokens" fmt variant={variant} />
        <StatCard value={stats.total_events} label="Events" fmt variant={variant} />
        <StatCard value={stats.total_agents} label="Agents" variant={variant} />
        <StatCard value={stats.total_sessions} label="Sessions" variant={variant} />
        <StatCard value={stats.total_time_seconds} label="Time" fmtFn={formatSeconds} variant={variant} />
        <StatCard value={stats.lines_changed} label="Lines" fmt variant={variant} />
        <StatCard value={stats.total_specs} label="Specs" variant={variant} />
        <StatCard value={stats.contributors} label="Coders" variant={variant} />
      </StatsGrid>
    </div>
  );
}

function MobileMetric({ value, label }: { value: number | undefined; label: string }) {
  return (
    <div className={mobileStyles.mobileMetric}>
      <span className={mobileStyles.mobileMetricValue}>{formatCompact(value ?? 0)}</span>
      <span className={mobileStyles.mobileMetricLabel}>{label}</span>
    </div>
  );
}

function MobileList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <section className={mobileStyles.mobileList} aria-label={title}>
      <h2>{title}</h2>
      <div>
        {rows.map((row) => (
          <div key={row.label} className={mobileStyles.mobileListRow}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
