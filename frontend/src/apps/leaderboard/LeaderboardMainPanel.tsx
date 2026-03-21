import { useMemo } from "react";
import { Text } from "@cypher-asi/zui";
import { Lane } from "../../components/Lane";
import { useLeaderboard } from "./LeaderboardContext";
import { useFollow } from "../../context/FollowContext";
import { formatTokens, formatCurrency } from "../../utils/format";
import styles from "./LeaderboardMainPanel.module.css";

export function LeaderboardMainPanel() {
  const { filter, selectedUserId, selectUser, entries } = useLeaderboard();
  const { followedProfileIds } = useFollow();

  const users = useMemo(() => {
    switch (filter) {
      case "my-agents":
        return entries.filter((u) => u.type === "agent");
      case "following":
        if (followedProfileIds.size === 0) return [];
        return entries.filter(
          (u) => u.profileId && followedProfileIds.has(u.profileId),
        );
      case "organization":
      case "everything":
      default:
        return entries;
    }
  }, [entries, filter, followedProfileIds]);

  const maxTokens = useMemo(
    () => Math.max(...users.map((u) => u.tokens), 1),
    [users],
  );

  return (
    <Lane flex style={{ borderLeft: "1px solid var(--color-border)" }}>
      <div className={styles.container}>
        <div className={styles.chartWrap}>
          <div className={styles.chartInner}>
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
                    {user.avatarUrl && (
                      <img src={user.avatarUrl} alt="" className={styles.avatar} />
                    )}
                    <Text size="sm" style={{ fontWeight: 500 }}>{user.name}</Text>
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
                    <span className={styles.metaSep}>·</span>
                    <span className={styles.metaValue}>
                      {user.eventCount.toLocaleString()} events
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Lane>
  );
}
