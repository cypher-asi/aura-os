import { useState, useEffect } from "react";
import { stripEmojis } from "../../utils/text-normalize";
import { formatDuration } from "../../utils/format";
import styles from "./ThinkingRow.module.css";

interface ThinkingRowProps {
  text: string;
  isStreaming: boolean;
  durationMs?: number | null;
  defaultExpanded?: boolean;
}

export function ThinkingRow({ text, isStreaming, durationMs, defaultExpanded }: ThinkingRowProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? isStreaming);

  useEffect(() => {
    if (isStreaming) {
      setExpanded(true);
      return;
    }
    // Defer collapse by two RAFs so the just-finalized bubble paints and
    // measures at its expanded height first. This makes the
    // StreamingBubble -> MessageBubble swap a visual no-op and turns the
    // subsequent collapse into a single clean layout change.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setExpanded(false);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [isStreaming]);

  const durationLabel = isStreaming
    ? "Thinking..."
    : durationMs != null
      ? `Thought for ${formatDuration(durationMs)}`
      : "Thought";

  return (
    <div className={`${styles.thinkingWrap}${isStreaming ? ` ${styles.streaming}` : ""}`}>
      <span
        className={`${styles.thinkingLabel} ${isStreaming ? styles.thinkingLabelShimmer : ""}`}
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpanded(!expanded); }}
      >
        {durationLabel}
      </span>
      {expanded && (
        <div className={styles.thinkingContent}>
          {stripEmojis(text)}
        </div>
      )}
    </div>
  );
}
