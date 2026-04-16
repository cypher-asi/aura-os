import { useEffect, useState } from "react";
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
    }
  }, [isStreaming]);

  const durationLabel = isStreaming
    ? "Thinking..."
    : durationMs != null
      ? `Thought for ${formatDuration(durationMs)}`
      : "Thought";

  const toggle = () => setExpanded((prev) => !prev);

  return (
    <div className={`${styles.thinkingWrap}${isStreaming ? ` ${styles.streaming}` : ""}`}>
      <span
        className={`${styles.thinkingLabel} ${isStreaming ? styles.thinkingLabelShimmer : ""}`}
        onClick={toggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggle(); }}
      >
        {durationLabel}
      </span>
      <div
        className={`${styles.thinkingContentWrap}${expanded ? ` ${styles.thinkingContentWrapExpanded}` : ""}`}
        aria-hidden={!expanded}
      >
        <div className={styles.thinkingContent}>
          {stripEmojis(text)}
        </div>
      </div>
    </div>
  );
}
