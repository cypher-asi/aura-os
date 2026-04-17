import { ChevronDown, ChevronUp, MessageSquare } from "lucide-react";
import { timeAgo } from "../../../utils/format";
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
  const handleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(item.id);
    }
  };

  const handleVote = (
    event: React.MouseEvent<HTMLButtonElement>,
    next: ViewerVote,
  ) => {
    event.stopPropagation();
    const resolved: ViewerVote = item.viewerVote === next ? "none" : next;
    onVote(item.id, resolved);
  };

  return (
    <div
      className={`${styles.card} ${isSelected ? styles.cardActive : ""}`}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={() => onSelect(item.id)}
      onKeyDown={handleCardKeyDown}
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
        <span className={styles.voteScore} aria-label="Vote score">
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

      <div className={styles.body}>
        <div className={styles.headerRow}>
          <span className={styles.authorName}>{item.author.name}</span>
          <span className={styles.separator}>&middot;</span>
          <span className={styles.timestamp}>{timeAgo(item.createdAt)}</span>
          <span className={styles.separator}>&middot;</span>
          <span className={styles.category}>{categoryLabel(item.category)}</span>
          <span className={styles.headerSpacer} />
          <span
            className={styles.statusTag}
            data-status={item.status}
          >
            {statusLabel(item.status)}
          </span>
        </div>

        <div className={styles.title}>{item.title}</div>
        <div className={styles.preview}>{item.body}</div>

        {item.commentCount > 0 ? (
          <button
            type="button"
            className={styles.commentPreview}
            aria-label={`${item.commentCount} comment${item.commentCount !== 1 ? "s" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(item.id);
            }}
          >
            <MessageSquare size={12} />
            {item.commentCount} comment{item.commentCount !== 1 ? "s" : ""}
          </button>
        ) : null}
      </div>
    </div>
  );
}
