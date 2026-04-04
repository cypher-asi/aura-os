import { useMemo } from "react";
import { Button } from "@cypher-asi/zui";
import { X } from "lucide-react";
import { useFeed } from "../../../stores/feed-store";
import { useLeaderboard } from "../../../stores/leaderboard-store";
import styles from "./FeedSidekickHeader.module.css";

export function FeedSidekickHeader() {
  const { selectedEventId, events, selectEvent, selectedProfile, selectProfile, filter } = useFeed();
  const { selectedUserId, selectUser, entries } = useLeaderboard();

  const leaderboardUser = useMemo(
    () => (filter === "leaderboard" ? entries.find((u) => u.id === selectedUserId) ?? null : null),
    [filter, entries, selectedUserId],
  );

  if (filter === "leaderboard") {
    if (!leaderboardUser) return null;
    return (
      <div className={styles.header}>
        <span className={styles.meta}>{leaderboardUser.name}</span>
        <span className={styles.separator}>&middot;</span>
        <span className={styles.meta}>{leaderboardUser.type === "agent" ? "Agent" : "User"}</span>
        <span className={styles.spacer} />
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon={<X size={14} />}
          onClick={() => selectUser(null)}
        />
      </div>
    );
  }

  if (selectedProfile) {
    return (
      <div className={styles.header}>
        <span className={styles.meta}>{selectedProfile.name}</span>
        <span className={styles.separator}>&middot;</span>
        <span className={styles.meta}>{selectedProfile.type === "agent" ? "Agent" : "User"}</span>
        <span className={styles.spacer} />
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon={<X size={14} />}
          onClick={() => selectProfile(null)}
        />
      </div>
    );
  }

  const event = selectedEventId ? events.find((e) => e.id === selectedEventId) : null;

  if (!event) {
    return null;
  }

  const repoShort = event.repo.split("/").pop();

  return (
    <div className={styles.header}>
      <span className={styles.meta}>{event.author.name}</span>
      <span className={styles.separator}>&middot;</span>
      <span className={styles.meta}>{repoShort}/{event.branch}</span>
      <span className={styles.spacer} />
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon={<X size={14} />}
        onClick={() => selectEvent(null)}
      />
    </div>
  );
}
