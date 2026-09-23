import { memo, useEffect, useState } from "react";
import { ChevronDown, Pencil, ArrowUp, Play, Trash2 } from "lucide-react";
import { useIsStreaming } from "../../../hooks/stream/hooks";
import { useMessageQueue } from "../../../stores/message-queue-store";
import type { QueuedMessage } from "../../../stores/message-queue-store";
import styles from "./MessageQueue.module.css";

interface Props {
  streamKey: string;
  onEdit: (item: QueuedMessage) => void;
  onRemove: (id: string) => void;
  /**
   * Cancel the in-flight turn and immediately send this queued
   * prompt. The button is only rendered when a stream is currently
   * active for `streamKey`; without an active turn the regular
   * dequeue-on-completion path picks the head item up on its own.
   */
  onSendNow?: (item: QueuedMessage) => void;
  /** Explicitly releases follow-ups restored in a held state after restart. */
  onResume?: () => void;
}

export const MessageQueue = memo(function MessageQueue({
  streamKey,
  onEdit,
  onRemove,
  onSendNow,
  onResume,
}: Props) {
  const queue = useMessageQueue(streamKey);
  const isStreaming = useIsStreaming(streamKey);
  const hasHeldMessages = queue.some((item) => item.heldAfterRestart);
  // Queued prompts now remain visible in the main transcript. Keep this
  // management panel collapsed by default so it does not duplicate the
  // prompt text; users can still expand it to edit/remove/send-now.
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    if (hasHeldMessages) setCollapsed(false);
  }, [hasHeldMessages]);

  if (queue.length === 0) return null;

  return (
    <div className={styles.queueContainer}>
      <div className={styles.queueHeader}>
        <button
          type="button"
          className={styles.queueToggle}
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
        >
        <span className={styles.queueCount}>
          {hasHeldMessages
            ? `${queue.length} held after restart`
            : `${queue.length} Queued`}
        </span>
        <ChevronDown
          size={14}
          className={`${styles.chevron} ${collapsed ? styles.chevronCollapsed : ""}`}
        />
        </button>
        {hasHeldMessages && onResume ? (
          <button
            type="button"
            className={styles.resumeButton}
            onClick={onResume}
          >
            <Play size={14} aria-hidden="true" />
            Resume queue
          </button>
        ) : null}
      </div>

      {!collapsed && (
        <div className={styles.queueList}>
          {queue.map((item) => (
            <div key={item.id} className={styles.queueItem}>
              <span className={`${styles.queueIndicator} ${item.heldAfterRestart ? styles.queueIndicatorHeld : ""}`} />
              <span className={styles.queueItemText}>{item.content}</span>
              <div className={styles.queueActions}>
                <button
                  type="button"
                  className={styles.queueActionBtn}
                  onClick={() => onEdit(item)}
                  aria-label="Edit message"
                >
                  <Pencil size={13} />
                </button>
                {onSendNow && isStreaming && (
                  <button
                    type="button"
                    className={`${styles.queueActionBtn} ${styles.queueActionBtnAccent}`}
                    onClick={() => onSendNow(item)}
                    aria-label="Send now (cancels current turn)"
                    title="Send now (cancels current turn)"
                  >
                    <ArrowUp size={13} />
                  </button>
                )}
                <button
                  type="button"
                  className={styles.queueActionBtn}
                  onClick={() => onRemove(item.id)}
                  aria-label="Remove from queue"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
