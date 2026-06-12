import { memo } from "react";
import styles from "./InputStatusHints.module.css";

export interface InputStatusHintsProps {
  /**
   * Phase 3 server signal: the most recent send is queued behind an
   * in-flight turn on the same upstream agent partition. Visually
   * distinct from the generic busy state so the user reads "your
   * message is next" rather than "the agent is blocked".
   */
  isQueued: boolean;
  /** Override for the queued hint copy. */
  queuedHint?: string;
  sendDisabled: boolean;
  sendDisabledReason?: string;
}

/** Inline status chips above the textarea: queued-send and send-disabled. */
export const InputStatusHints = memo(function InputStatusHints({
  isQueued,
  queuedHint,
  sendDisabled,
  sendDisabledReason,
}: InputStatusHintsProps) {
  return (
    <>
      {isQueued ? (
        <div
          className={styles.queuedHint}
          role="status"
          aria-live="polite"
          data-agent-surface="chat-input-queued-hint"
        >
          <span className={styles.queuedHintDot} aria-hidden="true" />
          <span className={styles.queuedHintLabel}>
            {queuedHint ?? "Queued behind current turn\u2026"}
          </span>
        </div>
      ) : null}
      {sendDisabled ? (
        <div
          className={styles.queuedHint}
          role="status"
          aria-live="polite"
          data-agent-surface="chat-input-disabled-hint"
        >
          <span className={styles.queuedHintLabel}>
            {sendDisabledReason ??
              "This is a local agent and can only be used in the desktop app."}
          </span>
        </div>
      ) : null}
    </>
  );
});
