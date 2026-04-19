import { useEffect, useMemo, useRef } from "react";
import { GitCommitVertical } from "lucide-react";
import { Lane } from "../../../components/Lane";
import { CommitGrid } from "../../../components/CommitGrid";
import { ActivityCard } from "../../../components/ActivityCard";
import { EmptyState } from "../../../components/EmptyState";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import { useAuraCapabilities } from "../../../hooks/use-aura-capabilities";
import { FEED_FILTERS } from "../feed-filters";
import { LeaderboardContent } from "../LeaderboardContent";
import { useFeed, useFeedStore } from "../../../stores/feed-store";
import styles from "./FeedMainPanel.module.css";

export function FeedMainPanel() {
  const init = useFeedStore((s) => s.init);
  useEffect(() => { init(); }, [init]);
  const { isMobileLayout } = useAuraCapabilities();
  const { filter, setFilter, filteredEvents, commitActivity, selectedEventId, selectEvent, selectProfile, getCommentsForEvent } = useFeed();

  const isLeaderboard = filter === "leaderboard";
  const hasCommitActivity = useMemo(
    () => Object.values(commitActivity).some((count) => count > 0),
    [commitActivity],
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <Lane flex>
      <div className={styles.container}>
        <div ref={scrollRef} className={styles.scrollArea}>
          {isMobileLayout ? (
            <div className={styles.mobileFilterBar} aria-label="Feed filters">
              {FEED_FILTERS.map((feedFilter) => {
                const isSelected = feedFilter.id === filter;
                return (
                  <button
                    key={feedFilter.id}
                    type="button"
                    className={`${styles.mobileFilterChip} ${isSelected ? styles.mobileFilterChipActive : ""}`}
                    aria-pressed={isSelected}
                    onClick={() => setFilter(feedFilter.id)}
                  >
                    {feedFilter.label}
                  </button>
                );
              })}
            </div>
          ) : null}
          {isLeaderboard ? (
            <LeaderboardContent />
          ) : filteredEvents.length === 0 ? (
            <div className={styles.emptyWrapper}>
              <EmptyState icon={<GitCommitVertical size={32} />}>It's quiet here.</EmptyState>
            </div>
          ) : (
            <>
              {hasCommitActivity ? (
                <div className={styles.commitGridWrapper}>
                  <CommitGrid data={commitActivity} />
                </div>
              ) : null}
              <div className={styles.feedList}>
                {filteredEvents.map((evt, i) => (
                  <ActivityCard
                    key={evt.id}
                    event={evt}
                    isLast={i === filteredEvents.length - 1}
                    isSelected={selectedEventId === evt.id}
                    comments={getCommentsForEvent(evt.id)}
                    onSelect={selectEvent}
                    onSelectProfile={(author) => selectProfile({ name: author.name, type: author.type, avatarUrl: author.avatarUrl })}
                  />
                ))}
              </div>
            </>
          )}
        </div>
        <OverlayScrollbar scrollRef={scrollRef} />
      </div>
    </Lane>
  );
}
