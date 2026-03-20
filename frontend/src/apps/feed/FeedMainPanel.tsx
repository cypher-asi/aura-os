/* eslint-disable react-refresh/only-export-components */
import { GitCommitVertical } from "lucide-react";
import { Lane } from "../../components/Lane";
import { CommitGrid } from "../../components/CommitGrid";
import { ActivityCard } from "../../components/ActivityCard";
import { EmptyState } from "../../components/EmptyState";
import { useFeed } from "./FeedProvider";
import styles from "./FeedMainPanel.module.css";

export { timeAgo } from "../../components/ActivityCard";

export function FeedMainPanel() {
  const { filteredEvents, commitActivity, selectedEventId, selectEvent, selectProfile, getCommentsForEvent } = useFeed();

  return (
    <Lane flex style={{ borderLeft: "1px solid var(--color-border)" }}>
      <div className={styles.container}>
        <div className={styles.scrollArea}>
          {filteredEvents.length === 0 ? (
            <EmptyState icon={<GitCommitVertical size={32} />}>It's quiet here.</EmptyState>
          ) : (
            <>
              <div className={styles.commitGridWrapper}>
                <CommitGrid data={commitActivity} />
              </div>
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
      </div>
    </Lane>
  );
}
