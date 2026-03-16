import { useState } from "react";
import { Text } from "@cypher-asi/zui";
import { Bot, User, MessageSquare, Send } from "lucide-react";
import { useFeed } from "./FeedProvider";
import { timeAgo } from "./FeedMainPanel";
import styles from "./FeedSidekickPanel.module.css";

export function FeedSidekickPanel() {
  const { selectedEventId, getCommentsForEvent, addComment } = useFeed();
  const [draft, setDraft] = useState("");

  if (!selectedEventId) {
    return (
      <div className={styles.emptyState}>
        <MessageSquare size={32} className={styles.emptyIcon} />
        <Text variant="muted" size="sm">Select a post to view comments</Text>
      </div>
    );
  }

  const comments = getCommentsForEvent(selectedEventId);

  const handleSubmit = () => {
    const text = draft.trim();
    if (!text) return;
    addComment(selectedEventId, text);
    setDraft("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.commentList}>
        {comments.length === 0 ? (
          <div className={styles.emptyState}>
            <Text variant="muted" size="sm">No comments yet</Text>
          </div>
        ) : (
          comments.map((c) => (
            <div key={c.id} className={styles.commentItem}>
              <div className={styles.commentAvatar}>
                {c.author.type === "agent" ? <Bot size={14} /> : <User size={14} />}
              </div>
              <div className={styles.commentContent}>
                <div className={styles.commentHeader}>
                  <span className={styles.commentAuthor}>{c.author.name}</span>
                  <span className={styles.commentTime}>{timeAgo(c.timestamp)}</span>
                </div>
                <span className={styles.commentText}>{c.text}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className={styles.inputArea}>
        <input
          className={styles.inputField}
          placeholder="Add a comment..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          className={styles.sendButton}
          onClick={handleSubmit}
          disabled={!draft.trim()}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
