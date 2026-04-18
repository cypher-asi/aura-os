import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import { Avatar } from "../../../components/Avatar";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import {
  useActiveNoteKey,
  useNoteComments,
  useNotesStore,
} from "../../../stores/notes-store";
import { timeAgo } from "../../../utils/format";
import styles from "./NotesCommentsPanel.module.css";

export function NotesCommentsPanel() {
  const activeKey = useActiveNoteKey();
  const comments = useNoteComments(
    activeKey?.projectId ?? null,
    activeKey?.relPath ?? null,
  );
  const addComment = useNotesStore((s) => s.addComment);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");

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

  if (!activeKey) {
    return <div className={styles.panel} />;
  }

  const handleSubmit = () => {
    const text = draft.trim();
    if (!text) return;
    void addComment(activeKey.projectId, activeKey.relPath, text);
    setDraft("");
  };

  return (
    <div className={styles.panel}>
      <div className={styles.commentListShell}>
        <div ref={scrollRef} className={styles.commentList}>
          {comments.length === 0 ? (
            <EmptyState>No comments yet</EmptyState>
          ) : (
            comments.map((comment) => (
              <div key={comment.id} className={styles.commentItem}>
                <Avatar
                  name={comment.authorName}
                  type="user"
                  size={28}
                  className={styles.commentAvatar}
                />
                <div className={styles.commentContent}>
                  <div className={styles.commentHeader}>
                    <span className={styles.commentAuthor}>
                      {comment.authorName}
                    </span>
                    <span className={styles.commentTime}>
                      {timeAgo(comment.createdAt)}
                    </span>
                  </div>
                  <span className={styles.commentText}>{comment.body}</span>
                </div>
              </div>
            ))
          )}
        </div>
        <OverlayScrollbar scrollRef={scrollRef} />
      </div>
      <div className={styles.inputArea}>
        <textarea
          ref={textareaRef}
          className={styles.inputField}
          placeholder="Add a comment..."
          aria-label="Add a comment"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleSubmit();
            }
          }}
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
