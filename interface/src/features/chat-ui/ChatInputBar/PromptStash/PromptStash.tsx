import { Bookmark, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PromptStashEntry } from "../../../../stores/prompt-stash-store";
import styles from "./PromptStash.module.css";

function snippet(entry: PromptStashEntry): string {
  const prompt = entry.prompt.replace(/\s+/g, " ").trim();
  if (prompt) return prompt.length > 90 ? `${prompt.slice(0, 90)}…` : prompt;
  if (entry.attachments.length > 0) {
    return `${entry.attachments.length} attachment${entry.attachments.length === 1 ? "" : "s"}`;
  }
  return `${entry.commands.length} command${entry.commands.length === 1 ? "" : "s"}`;
}

function relativeTime(createdAt: string): string {
  const elapsed = Date.now() - new Date(createdAt).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return "now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  return `${Math.floor(elapsed / 86_400_000)}d`;
}

export function PromptStashButton({
  count,
  open,
  onClick,
  className,
}: {
  count: number;
  open: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`${styles.stashButton}${className ? ` ${className}` : ""}`}
      onClick={onClick}
      aria-label={`Prompt shelf${count > 0 ? `, ${count} saved` : ""}`}
      aria-expanded={open}
      title="Prompt shelf (⌘S)"
      data-agent-action="toggle-prompt-stash"
    >
      <Bookmark size={15} />
      {count > 0 ? <span className={styles.count}>{count}</span> : null}
    </button>
  );
}

export function PromptStashMenu({
  entries,
  error,
  onRestore,
  onDelete,
  onClose,
}: {
  entries: readonly PromptStashEntry[];
  error?: string | null;
  onRestore: (entry: PromptStashEntry) => void;
  onDelete: (entry: PromptStashEntry) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(
    entries[0]?.id ?? null,
  );
  const effectiveHighlightedId = entries.some(
    (entry) => entry.id === highlightedId,
  )
    ? highlightedId
    : entries[0]?.id ?? null;
  const highlighted =
    entries.find((entry) => entry.id === effectiveHighlightedId) ?? entries[0];

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[data-agent-action="toggle-prompt-stash"]')
      ) {
        return;
      }
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (entries.length === 0) return;
        event.preventDefault();
        const currentIndex = entries.findIndex(
          (entry) => entry.id === effectiveHighlightedId,
        );
        const offset = event.key === "ArrowDown" ? 1 : -1;
        const start = currentIndex >= 0 ? currentIndex : 0;
        const nextIndex = (start + offset + entries.length) % entries.length;
        setHighlightedId(entries[nextIndex]?.id ?? null);
        return;
      }
      if (event.key === "Enter" && highlighted) {
        if (event.target instanceof HTMLElement && event.target.closest("button")) return;
        event.preventDefault();
        onRestore(highlighted);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [effectiveHighlightedId, entries, highlighted, onClose, onRestore]);

  return (
    <div
      ref={rootRef}
      className={styles.menu}
      role="dialog"
      aria-label="Saved prompts"
      data-agent-surface="prompt-stash"
    >
      <div className={styles.header}>
        <div>
          <strong>Prompt shelf</strong>
          <span>Save here, restore in any chat</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close prompt shelf">
          <X size={14} />
        </button>
      </div>
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {entries.length === 0 ? (
        <div className={styles.empty}>Nothing saved yet. Press ⌘S while drafting.</div>
      ) : (
        <div className={styles.list} role="listbox" aria-label="Saved prompts">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className={`${styles.entry}${highlighted?.id === entry.id ? ` ${styles.highlighted}` : ""}`}
              role="option"
              aria-selected={highlighted?.id === entry.id}
              onMouseEnter={() => setHighlightedId(entry.id)}
            >
              <button
                type="button"
                className={styles.restore}
                onClick={() => onRestore(entry)}
              >
                <span>{snippet(entry)}</span>
                <small>
                  {relativeTime(entry.createdAt)}
                  {entry.attachments.length > 0 ? ` · ${entry.attachments.length} files` : ""}
                  {entry.commands.length > 0 ? ` · ${entry.commands.length} commands` : ""}
                </small>
              </button>
              <button
                type="button"
                className={styles.delete}
                onClick={() => onDelete(entry)}
                aria-label="Delete saved prompt"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
