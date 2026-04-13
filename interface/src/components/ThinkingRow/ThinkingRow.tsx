import { useState, useEffect } from "react";
import { stripEmojis } from "../../utils/text-normalize";
import { formatDuration } from "../../utils/format";
import styles from "./ThinkingRow.module.css";

interface ThinkingRowProps {
  text: string;
  isStreaming: boolean;
  durationMs?: number | null;
}

export function ThinkingRow({ text, isStreaming, durationMs }: ThinkingRowProps) {
  const [expanded, setExpanded] = useState(isStreaming);

  useEffect(() => {
    if (isStreaming) {
      setExpanded(true);
    } else {
      setExpanded(false);
    }
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
