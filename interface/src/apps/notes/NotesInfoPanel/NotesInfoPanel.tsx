import { useMemo, useRef } from "react";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import { useActiveNote, useNotesStore } from "../../../stores/notes-store";
import styles from "./NotesInfoPanel.module.css";

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

function levelClass(level: number): string {
  if (level === 2) return styles.tocLevel2;
  if (level === 3) return styles.tocLevel3;
  if (level >= 4) return styles.tocLevel4;
  return "";
}

export function NotesInfoPanel() {
  const note = useActiveNote();
  const revealInFolder = useNotesStore((s) => s.revealInFolder);
  const scrollRef = useRef<HTMLDivElement>(null);

  const tocItems = useMemo(() => (note ? parseToc(note.content) : []), [note]);

  if (!note) {
    // Auto-selection fills the active note moments after mount; avoid a
    // flashing placeholder in the meantime.
    return <div className={styles.panel} />;
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
            <span className={`${styles.infoValue} ${styles.tocEmpty}`}>
              No headings yet
            </span>
          ) : (
            <ul className={styles.tocList}>
              {tocItems.map((item) => (
                <li
                  key={item.id}
                  className={`${styles.tocItem} ${levelClass(item.level)}`}
                >
                  <button type="button">{item.text}</button>
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
