import { useCallback, useEffect, useRef, useState } from "react";
import { Check, GitBranch, Link2, MoreHorizontal, RotateCcw } from "lucide-react";
import type { DisplaySessionEvent } from "../../../../shared/types/stream";
import { CopyButton } from "../../../../components/CopyButton";
import { MoreInfoPopover } from "../MoreInfoPopover";
import { useMessageActions } from "./useMessageActions";
import styles from "./MessageActions.module.css";

export interface MessageActionsProps {
  message: DisplaySessionEvent;
  streamKey: string;
}

/**
 * Footer action row for a completed assistant message: Copy, Share
 * (copy public link), Reload (regenerate this turn), and More (metadata
 * popover). All metadata sourcing, the share request, and the
 * regenerate handler are encapsulated in {@link useMessageActions}, so
 * this component takes only `message` + `streamKey`.
 */
export function MessageActions({ message, streamKey }: MessageActionsProps) {
  const {
    meta,
    shared,
    isSharing,
    canShare,
    isBranching,
    canBranch,
    copyShareLink,
    regenerate,
    branchConversation,
  } = useMessageActions(streamKey, message);
  const [moreOpen, setMoreOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const closeMore = useCallback(() => setMoreOpen(false), []);

  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  const ShareIcon = shared ? Check : Link2;
  let shareLabel = "Share link unavailable until session is ready";
  if (canShare) {
    shareLabel = shared ? "Share link copied" : "Copy share link";
  }

  return (
    <div className={styles.row} ref={wrapperRef}>
      <CopyButton
        getText={() => message.content}
        ariaLabel="Copy message"
        iconOnly
        className={styles.button}
      />
      <button
        type="button"
        className={`${styles.button} ${shared ? styles.buttonActive : ""}`}
        onClick={copyShareLink}
        disabled={isSharing || !canShare}
        aria-label={shareLabel}
        title={canShare ? "Copy share link" : "Share link unavailable until session is ready"}
        aria-live="polite"
      >
        <ShareIcon size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={regenerate}
        aria-label="Regenerate response"
      >
        <RotateCcw size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={() => void branchConversation()}
        disabled={!canBranch || isBranching}
        aria-label={isBranching ? "Branching conversation" : "Branch conversation here"}
        title="Start a new conversation from this reply"
      >
        <GitBranch size={14} aria-hidden="true" />
      </button>
      <span className={styles.moreAnchor}>
        <button
          type="button"
          className={`${styles.button} ${moreOpen ? styles.buttonActive : ""}`}
          onClick={() => setMoreOpen((prev) => !prev)}
          aria-label="More details"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
        >
          <MoreHorizontal size={14} aria-hidden="true" />
        </button>
        {moreOpen && <MoreInfoPopover meta={meta} onClose={closeMore} />}
      </span>
    </div>
  );
}
