import { useMemo } from "react";
import type { DebugLogEntry } from "../types";
import styles from "./DebugRunDetailView.module.css";

interface Props {
  entry: DebugLogEntry | null;
  onCopy: (text: string) => void;
}

/**
 * Right-hand inspector that shows the full parsed JSON of the
 * currently-selected entry with a one-click copy for hand-off into
 * issue trackers or the CLI analyzer.
 */
export function DebugEntryInspector({ entry, onCopy }: Props) {
  const formatted = useMemo(() => {
    if (!entry) return "";
    try {
      return JSON.stringify(entry.event, null, 2);
    } catch {
      return entry.raw;
    }
  }, [entry]);

  if (!entry) {
    return (
      <aside className={styles.inspector}>
        <div className={styles.inspectorHeader}>
          <span className={styles.inspectorTitle}>Select an event</span>
        </div>
        <div className={styles.empty}>
          Click a row on the left to inspect the full JSON payload.
        </div>
      </aside>
    );
  }

  return (
    <aside className={styles.inspector}>
      <div className={styles.inspectorHeader}>
        <span className={styles.inspectorTitle}>{entry.type}</span>
        <button
          type="button"
          className={styles.button}
          onClick={() => onCopy(formatted || entry.raw)}
        >
          Copy
        </button>
      </div>
      <pre className={styles.inspectorBody}>{formatted}</pre>
    </aside>
  );
}
