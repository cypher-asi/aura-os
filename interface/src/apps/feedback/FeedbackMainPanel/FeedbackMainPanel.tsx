import { useRef } from "react";
import { Lightbulb, MessageSquare } from "lucide-react";
import { Lane } from "../../../components/Lane";
import { EmptyState } from "../../../components/EmptyState";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import { useAuraCapabilities } from "../../../hooks/use-aura-capabilities";
import {
  useFeedback,
  useFeedbackBootstrap,
  useSortedFeedbackItems,
} from "../../../stores/feedback-store";
import { FEEDBACK_SORT_FILTERS } from "../feedback-filters";
import { FeedbackItemCard } from "../FeedbackItemCard";
import { NewFeedbackModal } from "../NewFeedbackModal";
import styles from "./FeedbackMainPanel.module.css";

function emptyMessage(isPending: boolean, loadError: string | null): string {
  if (isPending) return "Loading feedback...";
  if (loadError) return `Could not load feedback: ${loadError}`;
  return "No feedback yet. Use the New Idea button to post the first one.";
}

export function FeedbackMainPanel() {
  useFeedbackBootstrap();
  const { isMobileLayout } = useAuraCapabilities();
  const {
    sort,
    setSort,
    selectedId,
    selectItem,
    castVote,
    isLoading,
    hasLoaded,
    loadError,
    isComposerOpen,
    openComposer,
    closeComposer,
  } = useFeedback();
  // Treat "not yet bootstrapped" the same as "currently loading" so the
  // initial render shows "Loading feedback..." directly instead of first
  // flashing the "No feedback yet" empty-state before the bootstrap effect
  // has a chance to flip isLoading on.
  const isPending = isLoading || !hasLoaded;
  const sortedItems = useSortedFeedbackItems();
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <Lane flex>
      <div
        className={styles.container}
        data-demo-shot="feedback-main-panel"
        data-agent-surface="feedback-board"
      >
        <div
          className={styles.feedHeader}
          data-agent-section="feedback-actions"
        >
          <button
            type="button"
            className={styles.newIdeaButton}
            onClick={openComposer}
            aria-label="New Idea"
            title="Post a new idea"
            data-agent-action="open-feedback-composer"
            data-agent-target="feedback"
          >
            <Lightbulb size={14} aria-hidden="true" />
            <span>New Idea</span>
          </button>
        </div>
        <div ref={scrollRef} className={styles.scrollArea}>
          {isMobileLayout ? (
            <div className={styles.mobileFilterBar} aria-label="Feedback filters">
              {FEEDBACK_SORT_FILTERS.map((option) => {
                const isSelected = option.id === sort;
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`${styles.mobileFilterChip} ${isSelected ? styles.mobileFilterChipActive : ""}`}
                    aria-pressed={isSelected}
                    onClick={() => setSort(option.id)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          {sortedItems.length === 0 ? (
            <div className={styles.emptyWrapper} data-agent-empty-state="feedback-board-empty">
              <EmptyState icon={<MessageSquare size={32} />}>
                {emptyMessage(isPending, loadError)}
              </EmptyState>
            </div>
          ) : (
            <div
              className={styles.feedbackList}
              data-demo-shot="feedback-board-list"
              data-agent-list="feedback-items"
            >
              {sortedItems.map((item) => (
                <FeedbackItemCard
                  key={item.id}
                  item={item}
                  isSelected={selectedId === item.id}
                  onSelect={selectItem}
                  onVote={castVote}
                />
              ))}
            </div>
          )}
        </div>
        <OverlayScrollbar scrollRef={scrollRef} />
      </div>
      <NewFeedbackModal isOpen={isComposerOpen} onClose={closeComposer} />
    </Lane>
  );
}
