import { useEffect, useMemo } from "react";
import { Text } from "@cypher-asi/zui";
import { Avatar } from "../../../components/Avatar";
import { useLeaderboard, useLeaderboardStore } from "../../../stores/leaderboard-store";
import { formatTokens, formatCurrency } from "../../../utils/format";
import styles from "./LeaderboardContent.module.css";

export function LeaderboardContent() {
  const init = useLeaderboardStore((s) => s.init);
  useEffect(() => { init(); }, [init]);
  const { selectedUserId, selectUser, entries } = useLeaderboard();
  const users = entries;

  const maxTokens = useMemo(
    () => Math.max(...users.map((u) => u.tokens), 1),
    [users],
  );

  return (
    <div className={styles.list}>
      {users.map((user, i) => {
        const barPct = (user.tokens / maxTokens) * 100;
        return (
          <div
            key={user.id}
            className={`${styles.row} ${selectedUserId === user.id ? styles.rowActive : ""}`}
            onClick={() => selectUser(selectedUserId === user.id ? null : user.id)}
          >
            <div className={styles.rankCell}>
              <span className={styles.rankBadge}>{i + 1}</span>
            </div>
            <div className={styles.nameCell}>
              <Avatar
                avatarUrl={user.avatarUrl}
                name={user.name}
                type={user.type === "agent" ? "agent" : "user"}
                size={20}
              />
              <Text size="sm" className={styles.nameBold}>{user.name}</Text>
              {user.type === "agent" && (
                <span className={styles.typeBadge}>agent</span>
              )}
            </div>
            <div className={styles.barsCell}>
              <div className={styles.bar} style={{ width: `${barPct}%` }} />
            </div>
            <div className={styles.metaCell}>
              <span className={styles.metaValue} title={user.tokens.toLocaleString() + " tokens"}>
                {formatTokens(user.tokens)} tokens
              </span>
              <span className={styles.metaSep}>·</span>
              <span className={styles.metaValue} title={`$${user.estimatedCostUsd.toFixed(4)}`}>
                {formatCurrency(user.estimatedCostUsd)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
