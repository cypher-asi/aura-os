import { Text } from "@cypher-asi/zui";
import { useLeaderboard } from "./LeaderboardContext";
import type { TimePeriod } from "./mockData";
import styles from "./LeaderboardSidebar.module.css";

const periods: { value: TimePeriod; label: string }[] = [
  { value: "all", label: "All Time" },
  { value: "month", label: "This Month" },
  { value: "week", label: "This Week" },
];

export function LeaderboardSidebar() {
  const { period, setPeriod } = useLeaderboard();

  return (
    <div className={styles.root}>
      <div className={styles.section}>
        <Text variant="muted" size="xs" className={styles.sectionLabel}>
          Time Period
        </Text>
        <div className={styles.filters}>
          {periods.map((p) => (
            <button
              key={p.value}
              className={`${styles.filterBtn} ${period === p.value ? styles.active : ""}`}
              onClick={() => setPeriod(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
