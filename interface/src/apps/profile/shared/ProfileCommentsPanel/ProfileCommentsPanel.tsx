import { useState } from "react";
import type { FormEvent } from "react";
import { Send } from "lucide-react";
import { EmptyState } from "../../../../components/EmptyState";
import { Avatar } from "../../../../components/Avatar";
import {
  useProfileCommentsForEvent,
  useProfileStore,
} from "../../../../stores/profile-store";
import { timeAgo } from "../../../../shared/utils/format";
import styles from "./ProfileCommentsPanel.module.css";

interface ProfileCommentsPanelProps {
  eventId: string;
  variant?: "sidekick" | "drawer";
}

export function ProfileCommentsPanel({
  eventId,
  variant = "sidekick",
}: ProfileCommentsPanelProps) {
  const comments = useProfileCommentsForEvent(eventId);
  const addComment = useProfileStore((state) => state.addComment);
  const [draft, setDraft] = useState("");
  const panelClassName = [
    styles.panel,
    variant === "drawer" ? styles.drawerPanel : "",
  ].filter(Boolean).join(" ");

  const handleSubmit = (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    addComment(eventId, text);
    setDraft("");
  };

  return (
    <div className={panelClassName}>
      <div className={styles.commentList}>
        {comments.length === 0 ? (
          <EmptyState>No comments yet</EmptyState>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className={styles.commentItem}>
              <Avatar
                avatarUrl={comment.author.avatarUrl}
                name={comment.author.name}
                type={comment.author.type}
                size={variant === "drawer" ? 32 : 28}
                status={comment.author.status}
                className={styles.commentAvatar}
              />
              <div className={styles.commentContent}>
                <div className={styles.commentHeader}>
                  <span className={styles.commentAuthor}>{comment.author.name}</span>
                  <span className={styles.commentTime}>{timeAgo(comment.timestamp)}</span>
                </div>
                <span className={styles.commentText}>{comment.text}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <form className={styles.inputArea} onSubmit={handleSubmit}>
        <input
          className={styles.inputField}
          aria-label="Comment"
          placeholder="Add a comment..."
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          className={styles.sendButton}
          aria-label="Send comment"
          disabled={!draft.trim()}
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
