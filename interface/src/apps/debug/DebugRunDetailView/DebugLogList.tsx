import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { DebugLogEntry } from "../types";
import { summarizeEntry } from "../format-entry";
import styles from "./DebugRunDetailView.module.css";

interface Props {
  entries: DebugLogEntry[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  emptyMessage: string;
}

const ROW_HEIGHT = 28;

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(11, 23);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * Virtualized timeline. A debug bundle can easily exceed 10k events
 * per run when a dev loop loops for hours, so DOM-backed rendering is
 * not viable; `@tanstack/react-virtual` is already used by
 * `LeftMenuTree`, so we reuse the same approach instead of pulling in
 * another library.
 */
export function DebugLogList({
  entries,
  selectedIndex,
  onSelect,
  emptyMessage,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: (index) => entries[index]?.index ?? index,
  });

  if (entries.length === 0) {
    return <div className={styles.empty}>{emptyMessage}</div>;
  }

  return (
    <div ref={scrollRef} className={styles.list}>
      <div
        className={styles.listInner}
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const entry = entries[item.index];
          if (!entry) return null;
          const isActive = selectedIndex === entry.index;
          return (
            <div
              key={item.key}
              className={`${styles.row} ${isActive ? styles.rowActive : ""}`}
              style={{
                height: `${item.size}px`,
                transform: `translateY(${item.start}px)`,
              }}
              onClick={() => onSelect(entry.index)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(entry.index);
                }
              }}
            >
              <span className={styles.rowTime}>
                {formatTime(entry.timestamp)}
              </span>
              <span className={styles.rowType}>{entry.type}</span>
              <span className={styles.rowSummary}>{summarizeEntry(entry)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
