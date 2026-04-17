import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, MessageSquare } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import { Avatar } from "../../../components/Avatar";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import {
  useActiveNote,
  useActiveNoteKey,
  useNoteComments,
  useNotesStore,
} from "../../../stores/notes-store";
import { timeAgo } from "../../../utils/format";
import commentStyles from "../../feedback/FeedbackSidekickPanel/FeedbackSidekickPanel.module.css";
import styles from "./NotesSidekickPanel.module.css";

interface TocItem {
  id: string;
  level: number;
  text: string;
}

function parseToc(content: string): TocItem[] {
  const items: TocItem[] = [];
  let inFrontmatter = false;
  let seenFrontmatterFence = false;
  let inCodeFence = false;
  const lines = content.split(/\r?\n/);
  let counter = 0;
  for (const raw of lines) {
    const line = raw ?? "";
    if (!seenFrontmatterFence && line.trim() === "---") {
      inFrontmatter = true;
      seenFrontmatterFence = true;
      continue;
    }
    if (inFrontmatter) {
      if (line.trim() === "---") inFrontmatter = false;
      continue;
    }
    if (line.trim().startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;
    const match = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const level = match[1].length;
    const text = match[2].trim();
    counter += 1;
    items.push({ id: `toc-${counter}`, level, text });
  }
  return items;
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function NotesSidekickPanel() {
  const sidekickTab = useNotesStore((s) => s.sidekickTab);
  if (sidekickTab === "comments") return <NotesCommentsPanel />;
  return <NotesInfoPanel />;
}

function NotesInfoPanel() {
  const note = useActiveNote();
  const revealInFolder = useNotesStore((s) => s.revealInFolder);
  const scrollRef = useRef<HTMLDivElement>(null);

  const tocItems = useMemo(() => (note ? parseToc(note.content) : []), [note]);

  if (!note) {
    return (
      <EmptyState icon={<MessageSquare size={32} />}>
        Select a note to view info
      </EmptyState>
    );
  }

  return (
    <div className={styles.panel}>
      <div ref={scrollRef} className={styles.infoList}>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Title</span>
          <span className={styles.infoValue}>{note.title || "Untitled"}</span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Location</span>
          <button
            type="button"
            className={styles.pathButton}
            onClick={() => void revealInFolder(note.absPath)}
            title="Open containing folder"
          >
            {note.absPath}
          </button>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Created</span>
          <span className={styles.infoValue}>
            {formatDate(note.frontmatter.created_at)}
            {note.frontmatter.created_by ? ` · ${note.frontmatter.created_by}` : ""}
          </span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Last updated</span>
          <span className={styles.infoValue}>{formatDate(note.updatedAt)}</span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Word count</span>
          <span className={styles.infoValue}>{note.wordCount}</span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Table of contents</span>
          {tocItems.length === 0 ? (
            <span className={styles.infoValue} style={{ opacity: 0.6 }}>
              No headings yet
            </span>
          ) : (
            <ul className={styles.tocList}>
              {tocItems.map((item) => (
                <li
                  key={item.id}
                  className={`${styles.tocItem} ${
                    item.level === 2
                      ? styles.tocLevel2
                      : item.level === 3
                        ? styles.tocLevel3
                        : item.level >= 4
                          ? styles.tocLevel4
                          : ""
                  }`}
                >
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <OverlayScrollbar scrollRef={scrollRef} />
    </div>
  );
}

function NotesCommentsPanel() {
  const activeKey = useActiveNoteKey();
  const comments = useNoteComments(activeKey?.projectId ?? null, activeKey?.relPath ?? null);
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
    return (
      <EmptyState icon={<MessageSquare size={32} />}>
        Select a note to view comments
      </EmptyState>
    );
  }

  const handleSubmit = () => {
    const text = draft.trim();
    if (!text) return;
    void addComment(activeKey.projectId, activeKey.relPath, text);
    setDraft("");
  };

  return (
    <div className={commentStyles.panel}>
      <div className={commentStyles.commentListShell}>
        <div ref={scrollRef} className={commentStyles.commentList}>
          {comments.length === 0 ? (
            <EmptyState>No comments yet</EmptyState>
          ) : (
            comments.map((comment) => (
              <div key={comment.id} className={commentStyles.commentItem}>
                <Avatar
                  name={comment.authorName}
                  type="user"
                  size={28}
                  className={commentStyles.commentAvatar}
                />
                <div className={commentStyles.commentContent}>
                  <div className={commentStyles.commentHeader}>
                    <span className={commentStyles.commentAuthor}>
                      {comment.authorName}
                    </span>
                    <span className={commentStyles.commentTime}>
                      {timeAgo(comment.createdAt)}
                    </span>
                  </div>
                  <span className={commentStyles.commentText}>{comment.body}</span>
                </div>
              </div>
            ))
          )}
        </div>
        <OverlayScrollbar scrollRef={scrollRef} />
      </div>
      <div className={commentStyles.inputArea}>
        <textarea
          ref={textareaRef}
          className={commentStyles.inputField}
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
          className={commentStyles.sendButton}
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
