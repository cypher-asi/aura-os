import { Brain } from "lucide-react";
import { Block } from "./Block";
import { stripEmojis } from "../../shared/utils/text-normalize";
import { formatDuration } from "../../shared/utils/format";
import styles from "./ThinkingBlock.module.css";

interface ThinkingBlockProps {
  text: string;
  isStreaming: boolean;
  durationMs?: number | null;
}

/**
 * Collapsible reasoning panel built on the shared `Block` shell. While the
 * segment streams it is force-expanded with a shimmering "Thinking..."
 * header so the reasoning reveals live; the instant the segment closes
 * (`isStreaming` flips false) `Block`'s `forceExpanded` true -> false edge
 * snaps it back to `defaultExpanded` (collapsed), leaving a clickable
 * "Thought for Xs" summary the user can re-expand. A still-open segment
 * with no text yet renders header-only so the caption shimmers without a
 * stray empty body.
 */
export function ThinkingBlock({
  text,
  isStreaming,
  durationMs,
}: ThinkingBlockProps) {
  const cleanText = stripEmojis(text);

  const title = isStreaming
    ? "Thinking..."
    : durationMs != null
      ? `Thought for ${formatDuration(durationMs)}`
      : "Thought";

  // No reasoning text yet on an open segment: render just the shimmering
  // caption row (no body, no chevron) until the first token lands.
  const headerOnly = cleanText.length === 0;

  return (
    <Block
      title={
        <span className={isStreaming ? styles.labelShimmer : undefined}>
          {title}
        </span>
      }
      icon={<Brain size={12} />}
      status={isStreaming ? "pending" : "done"}
      copy={{ getText: () => cleanText || title, ariaLabel: "Copy thinking" }}
      forceExpanded={isStreaming && !headerOnly}
      defaultExpanded={false}
      headerOnly={headerOnly}
    >
      <div className={styles.thinkingText}>{cleanText}</div>
    </Block>
  );
}
