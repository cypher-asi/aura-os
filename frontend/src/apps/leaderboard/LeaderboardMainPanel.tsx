import { useMemo } from "react";
import { Text } from "@cypher-asi/zui";
import { Lane } from "../../components/Lane";
import { useLeaderboard } from "./LeaderboardContext";
import { useFollow } from "../../context/FollowContext";
import { formatTokens } from "../../utils/format";
import styles from "./LeaderboardMainPanel.module.css";

const AGENT_COLORS: Record<string, string> = {
  Atlas:  "#4aeaa8",
  Cipher: "#2db87a",
  Nova:   "#1a7a5a",
  Bolt:   "#0d4a3a",
};

const DEFAULT_COLOR = "#145a48";

function agentColor(name: string): string {
  return AGENT_COLORS[name] ?? DEFAULT_COLOR;
}

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
              const totalPct = (user.tokens / maxTokens) * 100;
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
                    <Text size="sm" style={{ fontWeight: 500 }}>{user.name}</Text>
                  </div>
                  <div className={styles.barsCell}>
                    <div className={styles.chunksRow} style={{ width: `${totalPct}%` }}>
                      {user.breakdown.length > 0 ? (
                        user.breakdown.map((b) => {
                          const share = user.tokens > 0 ? (b.tokens / user.tokens) * 100 : 0;
                          return (
                            <div
                              key={b.agent}
                              className={styles.chunk}
                              style={{
                                width: `${share}%`,
                                background: agentColor(b.agent),
                              }}
                              title={`${b.agent}: ${formatTokens(b.tokens)} tokens, ${b.commits} commits`}
                            />
                          );
                        })
                      ) : (
                        <div
                          className={styles.chunk}
                          style={{ width: "100%", background: DEFAULT_COLOR }}
                          title={`${formatTokens(user.tokens)} tokens`}
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className={styles.legend}>
            {Object.entries(AGENT_COLORS).map(([name, color]) => (
              <span key={name} className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: color }} />
                {name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Lane>
  );
}
