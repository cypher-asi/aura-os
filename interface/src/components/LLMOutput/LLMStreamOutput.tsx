import { useMemo } from "react";
import type { ArtifactRef, ToolCallEntry, TimelineItem } from "../../types/stream";
import { getStreamingPhaseLabel } from "../../utils/streaming";
import { expandToolMarkersInTimeline } from "../../utils/tool-markers";
import { CookingIndicator } from "../CookingIndicator";
import { LLMOutput } from "./LLMOutput";

export interface LLMStreamOutputProps {
  isStreaming: boolean;
  text: string;
  toolCalls?: ToolCallEntry[];
  thinkingText?: string;
  thinkingDurationMs?: number | null;
  timeline?: TimelineItem[];
  progressText?: string;
  artifactRefs?: ArtifactRef[];
  isWriting?: boolean;
  /**
   * When true (default) the inline phase indicator ("Cooking...", "Thinking...",
   * etc.) renders right below the streamed content. Chat contexts that pin the
   * indicator elsewhere pass `false` so it does not also appear inline and jitter
   * the scroll flow.
   */
  showPhaseIndicator?: boolean;
}

function StreamingIndicator({
  isStreaming,
  text,
  thinkingText,
  toolCalls,
  progressText,
  isWriting,
}: {
  isStreaming: boolean;
  text: string;
  thinkingText?: string;
  toolCalls?: ToolCallEntry[];
  progressText?: string;
  isWriting?: boolean;
}) {
  if (!isStreaming) return null;
  const label = getStreamingPhaseLabel({
    streamingText: text,
    thinkingText,
    toolCalls: toolCalls ?? [],
    progressText,
    isWriting,
  });
  return <CookingIndicator label={label ?? "Cooking..."} hidden={!label} />;
}

export function LLMStreamOutput({
  isStreaming,
  text,
  toolCalls,
  thinkingText,
  thinkingDurationMs,
  timeline,
  progressText,
  artifactRefs,
  isWriting,
  showPhaseIndicator = true,
}: LLMStreamOutputProps) {
  const { timelineForRender, toolCallsForRender } = useMemo<{
    timelineForRender: TimelineItem[];
    toolCallsForRender: ToolCallEntry[] | undefined;
  }>(() => {
    const baseToolCalls = toolCalls ?? [];
    let baseTimeline: TimelineItem[];
    if (timeline && timeline.length > 0) {
      baseTimeline = timeline;
    } else {
      const synthetic: TimelineItem[] = [];
      if (thinkingText) synthetic.push({ kind: "thinking", id: "live-thinking" });
      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          synthetic.push({ kind: "tool", toolCallId: tc.id, id: `live-tool-${tc.id}` });
        }
      }
      if (text) synthetic.push({ kind: "text", content: text, id: "live-text" });
      baseTimeline = synthetic;
    }

    const expanded = expandToolMarkersInTimeline(baseTimeline, baseToolCalls);
    return {
      timelineForRender: expanded.timeline,
      toolCallsForRender: expanded.toolCalls.length > 0 ? expanded.toolCalls : undefined,
    };
  }, [timeline, thinkingText, toolCalls, text]);

  return (
    <>
      <LLMOutput
        content={text}
        timeline={timelineForRender}
        toolCalls={toolCallsForRender}
        thinkingText={thinkingText}
        thinkingDurationMs={thinkingDurationMs}
        artifactRefs={artifactRefs}
        isStreaming={isStreaming}
      />
      {showPhaseIndicator && (
        <StreamingIndicator
          isStreaming={isStreaming}
          text={text}
          thinkingText={thinkingText}
          toolCalls={toolCalls}
          progressText={progressText}
          isWriting={isWriting}
        />
      )}
    </>
  );
}
