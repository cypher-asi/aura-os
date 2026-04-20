import { useCallback, useMemo, useRef } from "react";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import { useActiveNote } from "../../../stores/notes-store";
import styles from "./NotesTocPanel.module.css";

interface TocItem {
  id: string;
  level: number;
  text: string;
}

/**
 * Extract markdown headings (h1-h4) from a note's content, skipping YAML
 * frontmatter and fenced code blocks. Indices in the returned array
 * line up 1:1 with the rendered headings in the WYSIWYG editor's DOM, so
 * click handlers can use index-based lookup to scroll the editor.
 */
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

function levelClass(level: number): string {
  if (level === 2) return styles.tocLevel2;
  if (level === 3) return styles.tocLevel3;
  if (level >= 4) return styles.tocLevel4;
  return "";
}

/**
 * Scroll the main editor to the N-th heading (h1-h4). Matches the DOM order
 * of headings inside the `[data-notes-editor-root]` marker we add in
 * `NotesMainPanel`. No-op when the editor isn't mounted (e.g. in
 * Markdown-mode, which uses a raw `<textarea>`) or when the index is out
 * of range.
 */
function scrollToHeadingIndex(index: number): void {
  const root = document.querySelector<HTMLElement>("[data-notes-editor-root]");
  if (!root) return;
  const headings = root.querySelectorAll<HTMLElement>("h1, h2, h3, h4");
  const target = headings.item(index);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function NotesTocPanel() {
  const note = useActiveNote();
  const scrollRef = useRef<HTMLDivElement>(null);

  const tocItems = useMemo(() => (note ? parseToc(note.content) : []), [note]);

  const handleClick = useCallback((index: number) => {
    scrollToHeadingIndex(index);
  }, []);

  if (!note) {
    return <div className={styles.panel} />;
  }

  return (
    <div className={styles.panel}>
      <div ref={scrollRef} className={styles.list}>
        {tocItems.length === 0 ? (
          <span className={styles.empty}>No headings yet</span>
        ) : (
          <ul className={styles.tocList}>
            {tocItems.map((item, index) => (
              <li
                key={item.id}
                className={`${styles.tocItem} ${levelClass(item.level)}`}
              >
                <button
                  type="button"
                  onClick={() => handleClick(index)}
                  title={`Scroll to "${item.text}"`}
                >
                  {item.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <OverlayScrollbar scrollRef={scrollRef} />
    </div>
  );
}
