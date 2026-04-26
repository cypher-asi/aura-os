import type { ReactNode } from "react";
import styles from "./DebugMainPanel.module.css";

interface Props {
  children?: ReactNode;
}

/**
 * Chrome around the active `/debug` route. Unlike `IntegrationsMainPanel`
 * we intentionally do **not** wrap the content in a centered column with
 * hidden overflow, because the Debug Run Detail view owns its own
 * three-pane layout (toolbar + virtualized log list + inspector) and
 * needs to control scrolling itself. The shell provides the persistent
 * `ResponsiveMainLane`, so this component only renders inner chrome.
 */
export function DebugMainPanel({ children }: Props) {
  return (
    <div className={styles.container}>
      <div className={styles.scrollArea}>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}

/**
 * Default empty state shown at `/debug` when no project or run is
 * selected. Mirrors the copy used by `IntegrationsEmptyView` so the
 * shell's empty states feel consistent across apps.
 */
export function DebugEmptyView() {
  return (
    <div
      style={{
        padding: "48px",
        color: "var(--color-text-muted)",
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      <h2
        style={{
          color: "var(--color-text-primary)",
          fontSize: 18,
          marginBottom: 12,
        }}
      >
        Debug runs
      </h2>
      <p>
        Every dev-loop run is written to disk as a bundle containing events,
        LLM calls, iterations, blockers, and retries. Pick a project on the
        left to browse its runs.
      </p>
    </div>
  );
}
