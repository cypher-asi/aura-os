import { MessageSquare } from "lucide-react";
import { Lane } from "../../../components/Lane";
import { EmptyState } from "../../../components/EmptyState";
import { useAuraCapabilities } from "../../../hooks/use-aura-capabilities";
import {
  useFeedback,
  useSortedFeedbackItems,
} from "../../../stores/feedback-store";
import { FEEDBACK_SORT_FILTERS } from "../feedback-filters";
import { FeedbackItemCard } from "../FeedbackItemCard";
import styles from "./FeedbackMainPanel.module.css";

export function FeedbackMainPanel() {
  const { isMobileLayout } = useAuraCapabilities();
  const { sort, setSort, selectedId, selectItem, castVote } = useFeedback();
  const sortedItems = useSortedFeedbackItems();

  return (
    <Lane flex>
      <div className={styles.container}>
        <div className={styles.scrollArea}>
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
            <div className={styles.emptyWrapper}>
              <EmptyState icon={<MessageSquare size={32} />}>
                No feedback yet. Use the + button to post the first one.
              </EmptyState>
            </div>
          ) : (
            <div className={styles.feedbackList}>
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
      </div>
    </Lane>
  );
}
