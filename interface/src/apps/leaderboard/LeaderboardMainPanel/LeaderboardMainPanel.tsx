import { useEffect, useMemo } from "react";
import { Text } from "@cypher-asi/zui";
import { Lane } from "../../../components/Lane";
import { Avatar } from "../../../components/Avatar";
import { useAuraCapabilities } from "../../../hooks/use-aura-capabilities";
import { useLeaderboard, useLeaderboardStore } from "../../../stores/leaderboard-store";
import { useFollowStore } from "../../../stores/follow-store";
import { formatTokens, formatCurrency } from "../../../utils/format";
import { LEADERBOARD_FILTERS } from "../leaderboardFilters";
import styles from "./LeaderboardMainPanel.module.css";

export function LeaderboardMainPanel() {
  const init = useLeaderboardStore((s) => s.init);
  useEffect(() => { init(); }, [init]);
  const { isMobileLayout } = useAuraCapabilities();
  const { filter, setFilter, selectedUserId, selectUser, entries } = useLeaderboard();
  const followedProfileIds = useFollowStore((s) => s.followedProfileIds);

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
    <Lane flex className={styles.borderLeft}>
      <div className={styles.container}>
        <div className={styles.chartWrap}>
          {isMobileLayout ? (
            <div className={styles.mobileFilterBar} aria-label="Leaderboard filters">
              {LEADERBOARD_FILTERS.map((leaderboardFilter) => {
                const isSelected = leaderboardFilter.id === filter;
                return (
                  <button
                    key={leaderboardFilter.id}
                    type="button"
                    className={`${styles.mobileFilterChip} ${isSelected ? styles.mobileFilterChipActive : ""}`}
                    aria-pressed={isSelected}
                    onClick={() => setFilter(leaderboardFilter.id)}
                  >
                    {leaderboardFilter.label}
                  </button>
                );
              })}
            </div>
          ) : null}
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
