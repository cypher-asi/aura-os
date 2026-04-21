import { useMemo } from "react";
import type { DebugLogEntry } from "../../types";
import { EmptyState } from "../../../../components/EmptyState";
import { useDebugSidekickStore } from "../../stores/debug-sidekick-store";
import previewStyles from "../../../../components/Preview/Preview.module.css";
import styles from "./DebugSidekickContent.module.css";

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
}

interface Props {
  entry: DebugLogEntry;
}

/**
 * JSON detail panel shown inside the Sidekick when a row is selected.
 * The layout mirrors `ProcessInfoTab` (preview body with labelled
 * fields at the top, then a full-width code block) so the Debug app
 * feels consistent with the rest of the shell.
 */
export function EntryInspector({ entry }: Props) {
  const clearSelection = useDebugSidekickStore((s) => s.selectEntry);

  const formatted = useMemo(() => {
    try {
      return JSON.stringify(entry.event, null, 2);
    } catch {
      return entry.raw;
    }
  }, [entry]);

  return (
    <div className={previewStyles.previewBody}>
      <div className={previewStyles.taskMeta}>
        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Type</span>
          <span className={styles.inspectorType}>{entry.type}</span>
        </div>
        {entry.timestamp && (
          <div className={previewStyles.taskField}>
            <span className={previewStyles.fieldLabel}>Timestamp</span>
            <span className={styles.inspectorMono}>
              {new Date(entry.timestamp).toLocaleString()}
            </span>
          </div>
        )}
        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Channel</span>
          <span className={styles.inspectorMono}>{entry.channel}</span>
        </div>
        <div className={styles.inspectorActions}>
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => {
              void copyToClipboard(formatted || entry.raw);
            }}
          >
            Copy JSON
          </button>
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => clearSelection(null)}
          >
            Close
          </button>
        </div>
        <pre className={styles.inspectorCode}>{formatted}</pre>
      </div>
    </div>
  );
}

/** Wrapper rendered when no entry is selected. */
export function EntryInspectorEmpty() {
  return (
    <EmptyState>
      Click an event on the left to inspect the full JSON payload.
    </EmptyState>
  );
}
