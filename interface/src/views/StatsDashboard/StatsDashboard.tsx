import { useDelayedEmpty } from "../../hooks/use-delayed-empty";
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

  return (
    <div className={cx(styles.dashboardPadding, isMobile && mobileStyles.mobileDashboard)}>
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
