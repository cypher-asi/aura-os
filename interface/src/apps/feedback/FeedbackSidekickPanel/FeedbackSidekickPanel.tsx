import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, MessageSquare } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import { Avatar } from "../../../components/Avatar";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import {
  useAddFeedbackComment,
  useFeedback,
  useFeedbackComments,
  useFeedbackItem,
} from "../../../stores/feedback-store";
import { timeAgo } from "../../../utils/format";
import styles from "./FeedbackSidekickPanel.module.css";

export function FeedbackSidekickPanel() {
  const { selectedId } = useFeedback();
  const item = useFeedbackItem(selectedId);
  const comments = useFeedbackComments(selectedId);
  const addComment = useAddFeedbackComment();
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const commentListRef = useRef<HTMLDivElement>(null);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const cap = Math.min(window.innerHeight * 0.7, 800);
    el.style.height = Math.min(el.scrollHeight, cap) + "px";
  }, []);

  useEffect(() => {
    autoResize();
  }, [draft, autoResize]);

  if (!item) {
    return (
      <EmptyState icon={<MessageSquare size={32} />}>
        Select a feedback item to view comments
      </EmptyState>
    );
  }

  const handleSubmit = () => {
    const text = draft.trim();
    if (!text) return;
    addComment(item.id, text);
    setDraft("");
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.commentListShell}>
        <div ref={commentListRef} className={styles.commentList}>
          {comments.length === 0 ? (
            <EmptyState>No comments yet</EmptyState>
          ) : (
            comments.map((comment) => (
              <div key={comment.id} className={styles.commentItem}>
                <Avatar
                  avatarUrl={comment.author.avatarUrl}
                  name={comment.author.name}
                  type={comment.author.type}
                  size={28}
                  className={styles.commentAvatar}
                />
                <div className={styles.commentContent}>
                  <div className={styles.commentHeader}>
                    <span className={styles.commentAuthor}>{comment.author.name}</span>
                    <span className={styles.commentTime}>
                      {timeAgo(comment.createdAt)}
                    </span>
                  </div>
                  <span className={styles.commentText}>{comment.text}</span>
                </div>
              </div>
            ))
          )}
        </div>
        <OverlayScrollbar scrollRef={commentListRef} />
      </div>

      <div className={styles.inputArea}>
        <textarea
          ref={textareaRef}
          className={styles.inputField}
          placeholder="Add a comment..."
          aria-label="Add a comment"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button
          type="button"
          className={styles.sendButton}
          aria-label="Send comment"
          onClick={handleSubmit}
          disabled={!draft.trim()}
        >
          <ArrowUp size={16} />
        </button>
      </div>
    </div>
  );
}
