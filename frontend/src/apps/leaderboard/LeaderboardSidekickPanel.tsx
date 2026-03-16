import { useMemo, useState } from "react";
import { Text } from "@cypher-asi/zui";
import { User, Bot, MessageSquare, UserPlus, UserCheck, UserMinus } from "lucide-react";
import { EntityCard } from "../../components/EntityCard";
import { useLeaderboard } from "./LeaderboardContext";
import { useFollow } from "../../context/FollowContext";
import { useAuth } from "../../context/AuthContext";
import { getLeaderboard } from "./mockData";
import { formatTokens } from "../../utils/format";
import type { FollowTargetType } from "../../types";
import styles from "./LeaderboardSidekickPanel.module.css";

const AGENT_COLORS: Record<string, string> = {
  Atlas:  "#4aeaa8",
  Cipher: "#2db87a",
  Nova:   "#1a7a5a",
  Bolt:   "#0d4a3a",
};

function LeaderboardFollowButton({ targetName, targetType }: { targetName: string; targetType: FollowTargetType }) {
  const { isFollowing, toggleFollow } = useFollow();
  const [hover, setHover] = useState(false);
  const following = isFollowing(targetType, targetName);

  const icon = following
    ? hover ? <UserMinus size={12} /> : <UserCheck size={12} />
    : <UserPlus size={12} />;

  const label = following
    ? hover ? "Unfollow" : "Following"
    : "Follow";

  return (
    <button
      type="button"
      className={`${styles.followButton} ${following ? styles.followingState : ""}`}
      onClick={() => toggleFollow(targetType, targetName)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {icon}
      {label}
    </button>
  );
}

export function LeaderboardSidekickPanel() {
  const { period, filter, selectedUserId } = useLeaderboard();
  const { user: authUser } = useAuth();
  const users = useMemo(() => getLeaderboard(period, filter), [period, filter]);
  const user = useMemo(
    () => users.find((u) => u.id === selectedUserId) ?? null,
    [users, selectedUserId],
  );

  if (!user) {
    return (
      <div className={styles.emptyState}>
        <MessageSquare size={32} className={styles.emptyIcon} />
        <Text variant="muted" size="sm">Select a user to view profile</Text>
      </div>
    );
  }

  const isAgent = user.type === "agent";
  const followTargetType: FollowTargetType = isAgent ? "agent" : "user";
  const isOwnProfile = !isAgent && authUser?.display_name === user.name;

  return (
    <EntityCard
      headerLabel={isAgent ? "AGENT" : "USER"}
      headerStatus="ACTIVE"
      fallbackIcon={isAgent ? <Bot size={48} /> : <User size={48} />}
      name={user.name}
      nameAction={isOwnProfile ? undefined : <LeaderboardFollowButton targetName={user.name} targetType={followTargetType} />}
      stats={[
        { value: formatTokens(user.tokens), label: "Tokens" },
        { value: user.commits, label: "Commits" },
        { value: user.breakdown.length, label: "Agents" },
      ]}
      footer="CYPHER-ASI // AURA"
    >
      <div className={styles.breakdownSection}>
        <Text size="xs" variant="muted" style={{ textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>
          Agent Breakdown
        </Text>
        <div className={styles.breakdownList}>
          {user.breakdown.map((b) => (
            <div key={b.agent} className={styles.breakdownRow}>
              <span
                className={styles.breakdownDot}
                style={{ background: AGENT_COLORS[b.agent] ?? "#145a48" }}
              />
              <span className={styles.breakdownName}>{b.agent}</span>
              <span className={styles.breakdownValue}>{formatTokens(b.tokens)}</span>
              <span className={styles.breakdownCommits}>{b.commits} commits</span>
            </div>
          ))}
        </div>
      </div>
    </EntityCard>
  );
}
