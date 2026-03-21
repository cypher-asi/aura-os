import { useEffect } from "react";
import { GitCommitVertical } from "lucide-react";
import { Lane } from "../../components/Lane";
import { CommitGrid } from "../../components/CommitGrid";
import { ActivityCard } from "../../components/ActivityCard";
import { EmptyState } from "../../components/EmptyState";
import { useProfile, useProfileStore } from "../../stores/profile-store";
import styles from "./ProfileMainPanel.module.css";

export function ProfileMainPanel() {
  const init = useProfileStore((s) => s.init);
  useEffect(() => { init(); }, [init]);
  const { filteredEvents, commitActivity, selectedEventId, selectEvent, getCommentsForEvent } = useProfile();

  return (
    <Lane flex style={{ borderLeft: "1px solid var(--color-border)" }}>
      <div className={styles.container}>
        <div className={styles.scrollArea}>
          {filteredEvents.length === 0 ? (
            <div className={styles.emptyWrapper}>
              <EmptyState icon={<GitCommitVertical size={32} />}>No activity yet</EmptyState>
            </div>
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
