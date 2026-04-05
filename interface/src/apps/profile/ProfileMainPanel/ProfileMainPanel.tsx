import { useEffect, useMemo } from "react";
import { Drawer } from "@cypher-asi/zui";
import { GitCommitVertical, Loader2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Lane } from "../../../components/Lane";
import { CommitGrid } from "../../../components/CommitGrid";
import { ActivityCard } from "../../../components/ActivityCard";
import { EmptyState } from "../../../components/EmptyState";
import { useAuraCapabilities } from "../../../hooks/use-aura-capabilities";
import { useDelayedLoading } from "../../../hooks/use-delayed-loading";
import {
  buildFilteredProfileEvents,
  buildProfileCommitActivity,
  getProfileCommentsForEvent,
  useProfileEvents,
  useProfileStore,
} from "../../../stores/profile-store";
import {
  getProfileEventDetail,
  ProfileActionGroup,
  ProfileCommentsPanel,
  ProfileSummaryCard,
  useProfileSummaryModel,
} from "../shared";
import styles from "./ProfileMainPanel.module.css";

export function ProfileMainPanel() {
  const init = useProfileStore((s) => s.init);
  useEffect(() => { init(); }, [init]);
  const { isMobileLayout, isPhoneLayout } = useAuraCapabilities();
  const {
    projects,
    projectsStatus,
    selectedProject,
    setSelectedProject,
    selectedEventId,
    selectEvent,
    comments,
    eventsStatus,
  } = useProfileStore(
    useShallow((state) => ({
      projects: state.projects,
      projectsStatus: state.projectsStatus,
      selectedProject: state.selectedProject,
      setSelectedProject: state.setSelectedProject,
      selectedEventId: state.selectedEventId,
      selectEvent: state.selectEvent,
      comments: state.comments,
      eventsStatus: state.eventsStatus,
    })),
  );
  const events = useProfileEvents();
  const isLoadingActivity = eventsStatus === "idle" || eventsStatus === "loading" || projectsStatus === "idle" || projectsStatus === "loading";
  const showLoading = useDelayedLoading(isLoadingActivity);
  const filteredEvents = useMemo(
    () => buildFilteredProfileEvents(events, projects, selectedProject),
    [events, projects, selectedProject],
  );
  const commitActivity = useMemo(
    () => buildProfileCommitActivity(events, projects, selectedProject),
    [events, projects, selectedProject],
  );
  const selectedEvent = useMemo(
    () => (selectedEventId ? events.find((event) => event.id === selectedEventId) ?? null : null),
    [events, selectedEventId],
  );
  const summary = useProfileSummaryModel();

  const activityContent = showLoading ? (
    <div className={styles.emptyWrapper}>
      <EmptyState icon={<Loader2 size={32} className={styles.spinAnimation} />}>
        Loading activity...
      </EmptyState>
    </div>
  ) : filteredEvents.length === 0 ? (
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
            comments={getProfileCommentsForEvent(comments, evt.id)}
            onSelect={selectEvent}
          />
        ))}
      </div>
    </>
  );

  return (
    <Lane flex>
      <div className={styles.container}>
        <div className={styles.scrollArea}>
          {isMobileLayout ? (
            <div className={styles.mobileProfileStack}>
              <ProfileSummaryCard
                summary={summary}
                variant="mobile"
                showInlineFollowAction={false}
              />
              <ProfileActionGroup summary={summary} variant="stacked" />
              {projects.length > 0 ? (
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
              <div className={styles.mobileActivitySection}>
                {activityContent}
              </div>
            </div>
          ) : (
            activityContent
          )}
        </div>
        {isMobileLayout && selectedEventId ? (
          <Drawer
            side={isPhoneLayout ? "bottom" : "right"}
            isOpen
            onClose={() => selectEvent(null)}
            title={selectedEvent ? `${selectedEvent.author.name} · ${getProfileEventDetail(selectedEvent)}` : "Comments"}
            className={styles.mobileCommentsDrawer}
            showMinimizedBar={false}
            defaultSize={isPhoneLayout ? 420 : 380}
            maxSize={isPhoneLayout ? 560 : 460}
          >
            <ProfileCommentsPanel eventId={selectedEventId} variant="drawer" />
          </Drawer>
        ) : null}
      </div>
    </Lane>
  );
}
