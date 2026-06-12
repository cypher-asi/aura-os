import { Brain } from "lucide-react";
import { CopyButton } from "../CopyButton";
import { stripEmojis } from "../../shared/utils/text-normalize";
import { formatDuration } from "../../shared/utils/format";
import styles from "./ThinkingBlock.module.css";

interface ThinkingBlockProps {
  text: string;
  isStreaming: boolean;
  durationMs?: number | null;
}

/**
 * Inline thinking prose. Unlike tool rows (which use the collapsible
 * `Block` shell), thinking renders as full dimmed text in the timeline
 * flow under a small caption row — "Thinking..." with shimmer while the
 * segment streams, "Thought for Xs" once it closes. There is no
 * expand/collapse affordance: the whole point is that the reasoning
 * reads linearly between tool calls without an extra click.
 */
export function ThinkingBlock({
  text,
  isStreaming,
  durationMs,
}: ThinkingBlockProps) {
  const title = isStreaming
    ? "Thinking..."
    : durationMs != null
      ? `Thought for ${formatDuration(durationMs)}`
      : "Thought";

  const cleanText = stripEmojis(text);

  return (
    <div
      className={`${styles.thinking} ${isStreaming ? styles.thinkingStreaming : ""}`}
    >
      <div className={styles.thinkingHeader}>
        <span className={styles.thinkingIcon}>
          <Brain size={12} />
        </span>
        <span
          className={`${styles.thinkingLabel} ${isStreaming ? styles.thinkingLabelShimmer : ""}`}
        >
          {title}
        </span>
        {cleanText ? (
          <span className={styles.thinkingCopy}>
            <CopyButton
              getText={() => cleanText}
              ariaLabel="Copy thinking"
              iconOnly
            />
          </span>
        ) : null}
      </div>
      {cleanText ? (
        <div className={styles.thinkingText}>{cleanText}</div>
      ) : null}
    </div>
  );
}
