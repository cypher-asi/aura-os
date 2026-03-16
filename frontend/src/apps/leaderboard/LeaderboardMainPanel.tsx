import { useMemo } from "react";
import { Text } from "@cypher-asi/zui";
import { Lane } from "../../components/Lane";
import { useLeaderboard } from "./LeaderboardContext";
import { getLeaderboard } from "./mockData";
import { formatTokens } from "../../utils/format";
import styles from "./LeaderboardMainPanel.module.css";

const periodLabels: Record<string, string> = {
  all: "All Time",
  month: "This Month",
  week: "This Week",
};

const METRICS = [
  { key: "tokens" as const, label: "Tokens", color: "#4aeaa8" },
  { key: "commits" as const, label: "Commits", color: "#2db87a" },
  { key: "agents" as const, label: "Agents", color: "#1a7a5a" },
];

function formatValue(key: "tokens" | "commits" | "agents", value: number): string {
  if (key === "tokens") return formatTokens(value);
  return String(value);
}

export function LeaderboardMainPanel() {
  const { period, filter } = useLeaderboard();
  const users = useMemo(() => getLeaderboard(period, filter), [period, filter]);

  const maxValues = useMemo(() => {
    const maxTokens = Math.max(...users.map((u) => u.tokens), 1);
    const maxCommits = Math.max(...users.map((u) => u.commits), 1);
    const maxAgents = Math.max(...users.map((u) => u.agents), 1);
    return { tokens: maxTokens, commits: maxCommits, agents: maxAgents };
  }, [users]);

  return (
    <Lane flex style={{ borderLeft: "1px solid var(--color-border)" }}>
      <div className={styles.container}>
        <div className={styles.header}>
          <Text size="lg" style={{ fontWeight: 600 }}>
            Leaderboard
          </Text>
          <Text variant="muted" size="sm">
            {periodLabels[period]}
          </Text>
          <div className={styles.legend}>
            {METRICS.map((m) => (
              <span key={m.key} className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: m.color }} />
                {m.label}
              </span>
            ))}
          </div>
        </div>

        <div className={styles.chartWrap}>
          <div className={styles.chartInner}>
            {users.map((user, i) => (
              <div key={user.id} className={styles.row}>
                <div className={styles.rankCell}>
                  <span className={styles.rankBadge}>{i + 1}</span>
                </div>
                <div className={styles.nameCell}>
                  <Text size="sm" style={{ fontWeight: 500 }}>{user.name}</Text>
                </div>
                <div className={styles.barsCell}>
                  {METRICS.map((m) => {
                    const value = user[m.key];
                    const pct = (value / maxValues[m.key]) * 100;
                    return (
                      <div
                        key={m.key}
                        className={styles.barRow}
                        title={`${m.label}: ${value.toLocaleString()}`}
                      >
                        <div
                          className={styles.bar}
                          style={{ width: `${pct}%`, background: m.color }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Lane>
  );
}
