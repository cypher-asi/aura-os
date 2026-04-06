import { useState, useEffect } from "react";
import { stripEmojis } from "../../utils/text-normalize";
import { formatDuration } from "../../utils/format";
import { ResponseBlock } from "../ResponseBlock";
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
    <ResponseBlock
      expanded={expanded}
      onExpandedChange={setExpanded}
      animate={!isStreaming}
      className={`${styles.thinkingBlock}${isStreaming ? ` ${styles.thinkingBlockStreaming}` : ""}`}
      header={
        <span className={`${styles.thinkingLabel} ${isStreaming ? styles.thinkingLabelShimmer : ""}`}>
          {durationLabel}
        </span>
      }
    >
      <div className={styles.thinkingContent}>
        {stripEmojis(text)}
      </div>
    </ResponseBlock>
  );
}
