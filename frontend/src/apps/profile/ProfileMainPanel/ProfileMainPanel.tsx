import { useEffect } from "react";
import { GitCommitVertical } from "lucide-react";
import { Lane } from "../../../components/Lane";
import { CommitGrid } from "../../../components/CommitGrid";
import { ActivityCard } from "../../../components/ActivityCard";
import { EmptyState } from "../../../components/EmptyState";
import { useAuraCapabilities } from "../../../hooks/use-aura-capabilities";
import { useProfile, useProfileStore } from "../../../stores/profile-store";
import styles from "./ProfileMainPanel.module.css";

export function ProfileMainPanel() {
  const init = useProfileStore((s) => s.init);
  useEffect(() => { init(); }, [init]);
  const { isMobileLayout } = useAuraCapabilities();
  const {
    projects,
    selectedProject,
    setSelectedProject,
    filteredEvents,
    commitActivity,
    selectedEventId,
    selectEvent,
    getCommentsForEvent,
  } = useProfile();

  return (
    <Lane flex className={styles.borderLeft}>
      <div className={styles.container}>
        <div className={styles.scrollArea}>
          {isMobileLayout && projects.length > 0 ? (
            <div className={styles.mobileFilterBar} aria-label="Profile activity filter">
              <button
                type="button"
                className={`${styles.mobileFilterChip} ${selectedProject === null ? styles.mobileFilterChipActive : ""}`}
                aria-pressed={selectedProject === null}
                onClick={() => setSelectedProject(null)}
              >
                All activity
              </button>
              {projects.map((project) => {
                const isSelected = selectedProject === project.id;
                return (
                  <button
                    key={project.id}
                    type="button"
                    className={`${styles.mobileFilterChip} ${isSelected ? styles.mobileFilterChipActive : ""}`}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedProject(project.id)}
                  >
                    {project.name}
                  </button>
                );
              })}
            </div>
          ) : null}
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
