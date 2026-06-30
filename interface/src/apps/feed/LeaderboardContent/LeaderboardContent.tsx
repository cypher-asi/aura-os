import { useEffect, useMemo } from "react";
import { Text } from "@cypher-asi/zui";
import { Avatar } from "../../../components/Avatar";
import {
  useLeaderboard,
  useLeaderboardStore,
  startLeaderboardRefresh,
  stopLeaderboardRefresh,
} from "../../../stores/leaderboard-store";
import { formatTokens, formatCurrency } from "../../../shared/utils/format";
import styles from "./LeaderboardContent.module.css";

export function LeaderboardContent() {
  const init = useLeaderboardStore((s) => s.init);
  const fetchEntries = useLeaderboardStore((s) => s.fetchEntries);
  // Refresh whenever the leaderboard is opened (init() only fetches once per
  // app lifetime, so a revisit would otherwise show stale cached entries), and
  // keep it live with the periodic refresh while it's on screen. The interval
  // is torn down on unmount so nothing polls in the background.
  useEffect(() => {
    init();
    void fetchEntries();
    startLeaderboardRefresh();
    return () => stopLeaderboardRefresh();
  }, [init, fetchEntries]);
  const { selectedUserId, selectUser, entries } = useLeaderboard();
  const users = entries;

  const maxCost = useMemo(
    () => Math.max(...users.map((u) => u.estimatedCostUsd), 0.0001),
    [users],
  );

  return (
    <div className={styles.list}>
      {users.map((user, i) => {
        const barPct = (user.estimatedCostUsd / maxCost) * 100;
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
