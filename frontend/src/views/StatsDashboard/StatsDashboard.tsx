import { Text } from "@cypher-asi/zui";
import { useDelayedEmpty } from "../../hooks/use-delayed-empty";
import { EmptyState } from "../../components/EmptyState";
import { formatCompact, formatCurrency } from "../../utils/format";
import { useStatsDashboardData, PERIODS } from "./useStatsDashboardData";
import styles from "../aura.module.css";

export function StatsDashboard() {
  const { period, setPeriod, personal, org, loading } = useStatsDashboardData();

  const showEmpty = useDelayedEmpty(!personal && !org, loading, 0);
  const noData = !personal && !org;

  if (noData) {
    if (!showEmpty) return null;
    return <EmptyState>No usage data</EmptyState>;
  }

  return (
    <div className={styles.dashboardPadding}>
      <div className={styles.periodRow}>
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={styles.periodButton}
            style={{
              fontWeight: period === p.value ? 600 : 400,
              background: period === p.value ? "var(--color-bg-hover)" : "transparent",
              color: period === p.value ? "var(--color-text)" : "var(--color-text-muted)",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {personal && (
        <>
          <div className={styles.sectionMargin}>
            <Text variant="muted" size="xs" className={styles.uppercaseLabel}>
              Personal Usage
            </Text>
          </div>
          <div className={styles.statsGrid}>
            <StatCard value={personal.total_tokens} label="Total Tokens" fmt />
            <StatCard value={personal.total_input_tokens} label="Input" fmt />
            <StatCard value={personal.total_output_tokens} label="Output" fmt />
            <StatCard value={personal.total_cost_usd} label="Cost" fmtFn={formatCurrency} />
          </div>
        </>
      )}

      {org && (
        <>
          <div className={styles.sectionMarginTop}>
            <Text variant="muted" size="xs" className={styles.uppercaseLabel}>
              Organization Usage
            </Text>
          </div>
          <div className={styles.statsGrid}>
            <StatCard value={org.total_tokens} label="Total Tokens" fmt />
            <StatCard value={org.total_input_tokens} label="Input" fmt />
            <StatCard value={org.total_output_tokens} label="Output" fmt />
            <StatCard value={org.total_cost_usd} label="Cost" fmtFn={formatCurrency} />
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ value, label, fmt, fmtFn }: { value: number; label: string; fmt?: boolean; fmtFn?: (n: number) => string }) {
  const display = fmtFn ? fmtFn(value) : fmt ? formatCompact(value) : value;
  const title = (fmtFn || fmt) ? value.toLocaleString() : undefined;
  return (
    <div className={styles.statCard}>
      <div className={`${styles.statValue} ${styles.statCardValueColor}`} title={title}>{display}</div>
      <Text size="xs" align="center" className={styles.statCardLabel}>{label}</Text>
    </div>
  );
}
