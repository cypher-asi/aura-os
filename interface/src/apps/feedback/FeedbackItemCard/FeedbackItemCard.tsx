import type { MouseEvent } from "react";
import { ChevronDown, ChevronUp, MessageSquare } from "lucide-react";
import { timeAgo } from "../../../shared/utils/format";
import {
  categoryLabel,
  statusLabel,
  type FeedbackItem,
  type ViewerVote,
} from "../types";
import styles from "./FeedbackItemCard.module.css";

export interface FeedbackItemCardProps {
  item: FeedbackItem;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onVote: (id: string, vote: ViewerVote) => void;
}

export function FeedbackItemCard({
  item,
  isSelected,
  onSelect,
  onVote,
}: FeedbackItemCardProps) {
  const handleVote = (
    event: MouseEvent<HTMLButtonElement>,
    next: ViewerVote,
  ) => {
    event.stopPropagation();
    const resolved: ViewerVote = item.viewerVote === next ? "none" : next;
    onVote(item.id, resolved);
  };

  // The card splits into three interactive regions so we can use native
  // `<button>`s end-to-end (nesting buttons inside a single card-button
  // would be invalid HTML): the vote column with its own up/down buttons, a
  // primary `.body` button that owns "select this feedback", and an optional
  // comment-count button that also selects. They're laid out side-by-side
  // by the `.card` grid, so the card still reads as a single row visually.
  return (
    <article
      className={`${styles.card} ${isSelected ? styles.cardActive : ""}`}
      data-demo-shot={isSelected ? "feedback-selected-card" : undefined}
      data-agent-role="feedback-item"
      data-agent-item-id={item.id}
      data-agent-item-title={item.title}
      data-agent-item-status={item.status}
      data-agent-item-category={item.category}
      data-agent-context-anchor={isSelected ? "feedback-selected-item" : undefined}
    >
      <div className={styles.voteColumn}>
        <button
          type="button"
          className={`${styles.voteButton} ${item.viewerVote === "up" ? styles.voteButtonUp : ""}`}
          aria-label="Upvote"
          aria-pressed={item.viewerVote === "up"}
          onClick={(event) => handleVote(event, "up")}
        >
          <ChevronUp size={16} />
        </button>
        <span
          className={styles.voteScore}
          aria-label="Vote score"
          data-agent-proof="feedback-vote-score-visible"
        >
          {item.voteScore}
        </span>
        <button
          type="button"
          className={`${styles.voteButton} ${item.viewerVote === "down" ? styles.voteButtonDown : ""}`}
          aria-label="Downvote"
          aria-pressed={item.viewerVote === "down"}
          onClick={(event) => handleVote(event, "down")}
        >
          <ChevronDown size={16} />
        </button>
      </div>

      <button
        type="button"
        className={styles.body}
        aria-pressed={isSelected}
        aria-label={`Open feedback item: ${item.title || "Untitled feedback"}`}
        onClick={() => onSelect(item.id)}
      >
        <span className={styles.headerRow}>
          <span className={styles.authorName}>{item.author.name}</span>
          <span className={styles.separator}>&middot;</span>
          <span className={styles.timestamp}>{timeAgo(item.createdAt)}</span>
          <span className={styles.separator}>&middot;</span>
          <span className={styles.category}>{categoryLabel(item.category)}</span>
          <span className={styles.headerSpacer} />
          <span
            className={styles.statusTag}
            data-status={item.status}
            data-agent-proof="feedback-status-visible"
          >
            {statusLabel(item.status)}
          </span>
        </span>

        <span className={styles.title}>{item.title}</span>
        <span className={styles.preview}>{item.body}</span>
      </button>

      {item.commentCount > 0 ? (
        <button
          type="button"
          className={styles.commentPreview}
          aria-label={`Open ${item.commentCount} comment${item.commentCount !== 1 ? "s" : ""} for ${item.title || "feedback item"}`}
          data-agent-proof="feedback-comment-count-visible"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(item.id);
          }}
        >
          <MessageSquare size={12} />
          {item.commentCount} comment{item.commentCount !== 1 ? "s" : ""}
        </button>
      ) : null}
    </article>
  );
}
