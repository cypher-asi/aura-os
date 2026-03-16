import { useMemo } from "react";
import { Text } from "@cypher-asi/zui";
import { Lane } from "../../components/Lane";
import { useLeaderboard } from "./LeaderboardContext";
import { getLeaderboard } from "./mockData";
import { formatTokens } from "../../utils/format";
import { formatCost } from "../../utils/pricing";
import styles from "./LeaderboardMainPanel.module.css";

const periodLabels: Record<string, string> = {
  all: "All Time",
  month: "This Month",
  week: "This Week",
};

export function LeaderboardMainPanel() {
  const { period } = useLeaderboard();
  const users = useMemo(() => getLeaderboard(period), [period]);

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
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thRank}>#</th>
                <th className={styles.thName}>User</th>
                <th className={styles.thStat}>Tokens</th>
                <th className={styles.thStat}>Cost</th>
                <th className={styles.thStat}>Commits</th>
                <th className={styles.thStat}>Agents</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user, i) => {
                const rank = i + 1;

                return (
                  <tr key={user.id} className={styles.row}>
                    <td className={styles.cellRank}>
                      <span className={styles.rankBadge}>{rank}</span>
                    </td>
                    <td className={styles.cellName}>{user.name}</td>
                    <td className={styles.cellStat}>
                      {formatTokens(user.tokens)}
                    </td>
                    <td className={styles.cellStat}>
                      {formatCost(user.cost)}
                    </td>
                    <td className={styles.cellStat}>{user.commits}</td>
                    <td className={styles.cellStat}>{user.agents}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Lane>
  );
}
