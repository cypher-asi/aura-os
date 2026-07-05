import { memo } from "react";
import { Link } from "react-router-dom";
import styles from "./InputStatusHints.module.css";

export interface InputStatusAction {
  label: string;
  to: string;
}

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
  sendDisabledAction?: InputStatusAction;
}

/** Inline status chips above the textarea: queued-send and send-disabled. */
export const InputStatusHints = memo(function InputStatusHints({
  isQueued,
  queuedHint,
  sendDisabled,
  sendDisabledReason,
  sendDisabledAction,
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
              "This local agent is not available in this browser."}
          </span>
          {sendDisabledAction ? (
            <Link
              className={styles.hintAction}
              to={sendDisabledAction.to}
              data-agent-action="chat-disabled-handoff"
            >
              {sendDisabledAction.label}
            </Link>
          ) : null}
        </div>
      ) : null}
    </>
  );
});
