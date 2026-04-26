import { useMemo } from "react";
import type { ArtifactRef, TimelineItem, ToolCallEntry } from "../../../../shared/types/stream";
import { expandToolMarkersInTimeline } from "../../../../utils/tool-markers";
import { ActivityTimeline } from "../../../../components/ActivityTimeline";
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

  // Unify the render path behind ActivityTimeline so `[tool: read(...) -> ok]`
  // markers that arrive inline in assistant text (live stream, persisted turn
  // cache, or the plain-text fallback from `api.getTaskOutput`) consistently
  // render through the shared Block registry. Without this synthesis the
  // historical path used to short-circuit to `SegmentedContent`'s inline
  // row renderer, which the sidekick task overlay reported as a regression
  // (flat rows instead of collapsible Blocks).
  const { timelineForRender, toolCallsForRender } = useMemo<{
    timelineForRender: TimelineItem[];
    toolCallsForRender: ToolCallEntry[] | undefined;
  }>(() => {
    const baseToolCalls = toolCalls ?? [];
    let baseTimeline: TimelineItem[];
    if (hasTimeline && timeline) {
      baseTimeline = timeline;
    } else {
      const synthetic: TimelineItem[] = [];
      if (hasThinking) synthetic.push({ kind: "thinking", id: "synthetic-thinking" });
      if (hasToolCalls && toolCalls) {
        for (const tc of toolCalls) {
          synthetic.push({ kind: "tool", toolCallId: tc.id, id: `synthetic-tool-${tc.id}` });
        }
      }
      if (hasContent) {
        synthetic.push({ kind: "text", content, id: "synthetic-text" });
      }
      baseTimeline = synthetic;
    }

    const expanded = expandToolMarkersInTimeline(baseTimeline, baseToolCalls);
    return {
      timelineForRender: expanded.timeline,
      toolCallsForRender: expanded.toolCalls.length > 0 ? expanded.toolCalls : undefined,
    };
  }, [hasTimeline, timeline, hasThinking, hasToolCalls, toolCalls, hasContent, content]);

  if (!hasContent && !hasToolCalls && !hasThinking && !hasTimeline) return null;

  return (
    <div className={`${styles.root} ${className ?? ""}`}>
      {timelineForRender.length > 0 && (
        <ActivityTimeline
          timeline={timelineForRender}
          thinkingText={thinkingText}
          thinkingDurationMs={thinkingDurationMs}
          toolCalls={toolCallsForRender}
          isStreaming={isStreaming}
          defaultThinkingExpanded={defaultThinkingExpanded}
          defaultActivitiesExpanded={defaultActivitiesExpanded}
        />
      )}
      {hasArtifactRefs && artifactRefs && (
        <ArtifactRefsList refs={artifactRefs} />
      )}
    </div>
  );
}
