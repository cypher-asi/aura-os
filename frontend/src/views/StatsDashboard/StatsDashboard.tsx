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
    <div style={{ padding: "var(--space-3) var(--space-3)" }}>
      <div style={{ display: "flex", gap: "var(--space-1)", marginBottom: "var(--space-3)" }}>
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            style={{
              padding: "2px 10px",
              fontSize: 11,
              fontWeight: period === p.value ? 600 : 400,
              background: period === p.value ? "var(--color-bg-hover)" : "transparent",
              border: "1px solid var(--color-border)",
              borderRadius: 4,
              color: period === p.value ? "var(--color-text)" : "var(--color-text-muted)",
              cursor: "pointer",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {personal && (
        <>
          <div style={{ margin: "0 0 var(--space-1)" }}>
            <Text variant="muted" size="xs" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
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
          <div style={{ margin: "var(--space-2) 0 var(--space-1)" }}>
            <Text variant="muted" size="xs" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
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
    <div style={{ padding: "var(--space-1) var(--space-2)", textAlign: "center", height: 64, display: "flex", flexDirection: "column", justifyContent: "center", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md, 6px)" }}>
      <div className={styles.statValue} style={{ color: "var(--color-text-secondary)" }} title={title}>{display}</div>
      <Text size="xs" align="center" style={{ color: "var(--color-text-muted)", fontSize: 10 }}>{label}</Text>
    </div>
  );
}
