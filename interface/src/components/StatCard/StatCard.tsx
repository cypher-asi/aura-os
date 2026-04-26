import { Text } from "@cypher-asi/zui";
import { formatCompact } from "../../shared/utils/format";
import styles from "../../views/aura.module.css";
import mobileStyles from "../../views/StatsDashboard/StatsDashboard.module.css";

export function cx(...classNames: Array<string | false | null | undefined>): string {
  return classNames.filter(Boolean).join(" ");
}

export function formatCardCost(usd: number): string {
  const safe = Number.isFinite(usd) ? usd : 0;
  return `$${safe.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatSeconds(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  const mins = Math.floor(s / 60);
  if (mins < 60) return `${mins}m ${Math.round(s % 60)}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

type StatVariant = "sidekick" | "mobile";

export function StatCard({
  value,
  label,
  fmt,
  fmtFn,
  variant = "sidekick",
  accent,
}: {
  value: number | undefined;
  label: string;
  fmt?: boolean;
  fmtFn?: (n: number) => string;
  variant?: StatVariant;
  accent?: "success";
}) {
  const isMobile = variant === "mobile";
  const safeValue = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const display = fmtFn ? fmtFn(safeValue) : fmt ? formatCompact(safeValue) : safeValue;
  const title = fmtFn || fmt ? safeValue.toLocaleString() : undefined;
  const valueColorClass =
    accent === "success" ? styles.statCardValueSuccess : styles.statCardValueColor;
  const proofId = `project-stat-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  return (
    <div
      className={cx(styles.statCard, isMobile && mobileStyles.mobileStatCard)}
      data-agent-proof={proofId}
    >
      <div
        className={cx(
          styles.statValue,
          valueColorClass,
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

export function SectionHeader({
  children,
  first,
  variant = "sidekick",
}: {
  children: React.ReactNode;
  first?: boolean;
  variant?: StatVariant;
}) {
  const isMobile = variant === "mobile";
  return (
    <div
      className={cx(
        first ? styles.sectionMargin : styles.sectionMarginTop,
        isMobile && (first ? mobileStyles.mobileSectionMargin : mobileStyles.mobileSectionMarginTop),
      )}
    >
      <Text
        variant="muted"
        size="xs"
        className={cx(styles.uppercaseLabel, isMobile && mobileStyles.mobileSectionLabel)}
      >
        {children}
      </Text>
    </div>
  );
}

export function StatsGrid({
  children,
  variant = "sidekick",
}: {
  children: React.ReactNode;
  variant?: StatVariant;
}) {
  const isMobile = variant === "mobile";
  return (
    <div className={cx(styles.statsGrid, isMobile && mobileStyles.mobileStatsGrid)}>
      {children}
    </div>
  );
}

export function ProgressBar({
  percentage,
  variant = "sidekick",
}: {
  percentage: number;
  variant?: StatVariant;
}) {
  const isMobile = variant === "mobile";
  return (
    <div
      className={cx(styles.completionRow, isMobile && mobileStyles.mobileCompletionRow)}
      data-agent-proof="project-completion-progress"
    >
      <div
        className={cx(styles.progressBarContainer, isMobile && mobileStyles.mobileProgressBarContainer)}
        style={{ flex: 1 }}
      >
        <div
          className={cx(styles.progressBarFill, isMobile && mobileStyles.mobileProgressBarFill)}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
      <Text size="xs" className={cx(styles.progressPct, isMobile && mobileStyles.mobileProgressPct)}>
        {Math.round(percentage)}%
      </Text>
    </div>
  );
}
