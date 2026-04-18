import { useMemo, useEffect, useState } from "react";
import { Text } from "@cypher-asi/zui";
import { User, Bot, BarChart3 } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import { EntityCard } from "../../../components/EntityCard";
import { FollowEditButton } from "../../../components/FollowEditButton";
import { useLeaderboard, useLeaderboardStore } from "../../../stores/leaderboard-store";
import { useAuth } from "../../../stores/auth-store";
import { formatTokens, formatCurrency } from "../../../utils/format";
import { api } from "../../../api/client";
import styles from "./LeaderboardSidekick.module.css";

interface PlatformStats {
  daily_active_users: number;
  total_users: number;
  new_signups: number;
  projects_created: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_revenue_usd: number;
}

export function LeaderboardSidekick() {
  const init = useLeaderboardStore((s) => s.init);
  useEffect(() => { init(); }, [init]);
  const { selectedUserId, entries } = useLeaderboard();
  const { user: authUser } = useAuth();
  const user = useMemo(
    () => entries.find((u) => u.id === selectedUserId) ?? null,
    [entries, selectedUserId],
  );

  const [platformStats, setPlatformStats] = useState<PlatformStats | null>(null);

  useEffect(() => {
    if (selectedUserId) return;
    api.platformStats.get().then((s) => setPlatformStats(s ?? null)).catch(() => setPlatformStats(null));
  }, [selectedUserId]);

  if (!user) {
    if (!platformStats) {
      return (
        <EmptyState icon={<BarChart3 size={32} />}>Select a user to view profile</EmptyState>
      );
    }

    return (
      <div className={styles.platformSection}>
        <Text size="xs" variant="muted" className={styles.uppercaseLabel}>
          Platform Stats
        </Text>
        <div className={styles.statsGrid}>
          <StatTile value={platformStats.total_users.toLocaleString()} label="Total Users" />
          <StatTile value={platformStats.daily_active_users.toLocaleString()} label="DAU" />
          <StatTile value={platformStats.new_signups.toLocaleString()} label="Today's Signups" />
          <StatTile value={platformStats.projects_created.toLocaleString()} label="Total Projects" />
          <StatTile value={formatTokens(platformStats.total_input_tokens + platformStats.total_output_tokens)} label="Total Tokens" />
          <StatTile value={formatCurrency(platformStats.total_revenue_usd)} label="Total Revenue" />
        </div>
      </div>
    );
  }

  const isAgent = user.type === "agent";
  const isOwnProfile = !isAgent && !!authUser?.profile_id && authUser.profile_id === user.profileId;

  return (
    <EntityCard
      headerLabel={isAgent ? "AGENT" : "USER"}
      headerStatus="ACTIVE"
      image={user.avatarUrl}
      fallbackIcon={isAgent ? <Bot size={48} /> : <User size={48} />}
      name={user.name}
      nameAction={
        isOwnProfile ? undefined : (
          <FollowEditButton
            isOwner={false}
            targetProfileId={user.profileId}
          />
        )
      }
      stats={[
        { value: formatTokens(user.tokens), label: "Tokens" },
        { value: formatCurrency(user.estimatedCostUsd), label: "Cost" },
      ]}
      footer="CYPHER-ASI // AURA"
    />
  );
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className={styles.statTile}>
      <div className={styles.statTileValue}>{value}</div>
      <Text size="xs" className={styles.statTileLabel}>{label}</Text>
    </div>
  );
}
