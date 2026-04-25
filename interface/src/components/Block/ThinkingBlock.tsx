import { Brain } from "lucide-react";
import { Block } from "./Block";
import { stripEmojis } from "../../shared/utils/text-normalize";
import { formatDuration } from "../../shared/utils/format";
import styles from "./ThinkingBlock.module.css";

interface ThinkingBlockProps {
  text: string;
  isStreaming: boolean;
  durationMs?: number | null;
  defaultExpanded?: boolean;
}

export function ThinkingBlock({
  text,
  isStreaming,
  durationMs,
  defaultExpanded,
}: ThinkingBlockProps) {
  const title = isStreaming
    ? "Thinking..."
    : durationMs != null
      ? `Thought for ${formatDuration(durationMs)}`
      : "Thought";

  const titleNode = (
    <span className={isStreaming ? styles.thinkingLabelShimmer : ""}>
      {title}
    </span>
  );

  return (
    <Block
      className={`${styles.thinkingBlock} ${isStreaming ? styles.thinkingBlockStreaming : ""}`}
      icon={<Brain size={12} />}
      title={titleNode}
      status={isStreaming ? "pending" : "done"}
      defaultExpanded={defaultExpanded ?? isStreaming}
      forceExpanded={isStreaming}
      autoScroll={isStreaming}
    >
      <div className={styles.thinkingText}>{stripEmojis(text)}</div>
    </Block>
  );
}
