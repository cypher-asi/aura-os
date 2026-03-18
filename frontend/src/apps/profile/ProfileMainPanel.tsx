import { GitCommitVertical } from "lucide-react";
import { Lane } from "../../components/Lane";
import { CommitGrid } from "../../components/CommitGrid";
import { ActivityCard } from "../../components/ActivityCard";
import { EmptyState } from "../../components/EmptyState";
import { useProfile } from "./ProfileProvider";
import styles from "./ProfileMainPanel.module.css";

export function ProfileMainPanel() {
  const { filteredEvents, commitActivity, selectedEventId, selectEvent, getCommentsForEvent } = useProfile();

  return (
    <Lane flex style={{ borderLeft: "1px solid var(--color-border)" }}>
      <div className={styles.container}>
        <div className={styles.scrollArea}>
          <div className={styles.commitGridWrapper}>
            <CommitGrid data={commitActivity} />
          </div>

          {filteredEvents.length === 0 ? (
            <EmptyState icon={<GitCommitVertical size={32} />}>No activity yet</EmptyState>
          ) : (
            <div className={styles.feedList}>
              {filteredEvents.map((evt, i) => (
                <ActivityCard
                  key={evt.id}
                  event={evt}
                  isLast={i === filteredEvents.length - 1}
                  isSelected={selectedEventId === evt.id}
                  comments={getCommentsForEvent(evt.id)}
                  onSelect={selectEvent}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </Lane>
  );
}
