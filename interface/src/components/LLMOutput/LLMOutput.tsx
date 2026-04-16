import { useMemo } from "react";
import type { ArtifactRef, TimelineItem, ToolCallEntry } from "../../types/stream";
import {
  stripEmojis,
  normalizeMidSentenceBreaks,
  flattenListIndentation,
  normalizeLooseStrongEmphasis,
} from "../../utils/text-normalize";
import { ActivityTimeline } from "../ActivityTimeline";
import { ThinkingRow } from "../ThinkingRow";
import { ToolCallsList } from "../ToolRow";
import { SegmentedContent } from "../SegmentedContent";
import styles from "./LLMOutput.module.css";

interface ArtifactRefsListProps {
  refs: ArtifactRef[];
}

function ArtifactRefsList({ refs }: ArtifactRefsListProps) {
  const tasks = refs.filter((r) => r.kind === "task");
  const specs = refs.filter((r) => r.kind === "spec");
  return (
    <div className={styles.artifactRefs}>
      {specs.map((ref) => (
        <div key={ref.id} className={styles.artifactRef}>
          <span className={styles.artifactRefIcon}>spec</span>
          <span className={styles.artifactRefTitle}>{ref.title}</span>
        </div>
      ))}
      {tasks.map((ref) => (
        <div key={ref.id} className={styles.artifactRef}>
          <span className={styles.artifactRefIcon}>task</span>
          <span className={styles.artifactRefTitle}>{ref.title}</span>
        </div>
      ))}
    </div>
  );
}

export interface LLMOutputProps {
  content: string;
  timeline?: TimelineItem[];
  toolCalls?: ToolCallEntry[];
  thinkingText?: string;
  thinkingDurationMs?: number | null;
  artifactRefs?: ArtifactRef[];
  isStreaming?: boolean;
  className?: string;
  defaultThinkingExpanded?: boolean;
  defaultActivitiesExpanded?: boolean;
}

export function LLMOutput({
  content,
  timeline,
  toolCalls,
  thinkingText,
  thinkingDurationMs,
  artifactRefs,
  isStreaming = false,
  className,
  defaultThinkingExpanded,
  defaultActivitiesExpanded,
}: LLMOutputProps) {
  const hasContent = content && content.trim().length > 0;
  const hasToolCalls = toolCalls && toolCalls.length > 0;
  const hasThinking = thinkingText && thinkingText.length > 0;
  const hasArtifactRefs = artifactRefs && artifactRefs.length > 0;
  const hasTimeline = timeline && timeline.length > 0;

  const normalizedContent = useMemo(
    () =>
      hasContent
        ? normalizeLooseStrongEmphasis(
            flattenListIndentation(normalizeMidSentenceBreaks(stripEmojis(content))),
          )
        : "",
    [hasContent, content],
  );

  if (!hasContent && !hasToolCalls && !hasThinking && !hasTimeline) return null;

  return (
    <div className={`${styles.root} ${className ?? ""}`}>
      {hasTimeline ? (
        <ActivityTimeline
          timeline={timeline}
          thinkingText={thinkingText}
          thinkingDurationMs={thinkingDurationMs}
          toolCalls={toolCalls}
          isStreaming={isStreaming}
          defaultThinkingExpanded={defaultThinkingExpanded}
          defaultActivitiesExpanded={defaultActivitiesExpanded}
        />
      ) : (
        <div className={styles.fallbackStack}>
          {hasThinking && thinkingText && (
            <ThinkingRow
              text={thinkingText}
              isStreaming={isStreaming}
              durationMs={thinkingDurationMs}
              defaultExpanded={defaultThinkingExpanded}
            />
          )}
          {hasToolCalls && toolCalls && (
            <ToolCallsList entries={toolCalls} />
          )}
          {hasContent && (
            <SegmentedContent content={normalizedContent} isStreaming={isStreaming} />
          )}
        </div>
      )}
      {hasArtifactRefs && artifactRefs && (
        <ArtifactRefsList refs={artifactRefs} />
      )}
    </div>
  );
}
