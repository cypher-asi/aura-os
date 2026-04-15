import { useMemo } from "react";
import type { ArtifactRef, ToolCallEntry, TimelineItem } from "../../types/stream";
import { getStreamingPhaseLabel } from "../../utils/streaming";
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
}

function StreamingIndicator({
  isStreaming,
  text,
  thinkingText,
  toolCalls,
  progressText,
}: {
  isStreaming: boolean;
  text: string;
  thinkingText?: string;
  toolCalls?: ToolCallEntry[];
  progressText?: string;
}) {
  if (!isStreaming) return null;
  const label = getStreamingPhaseLabel({
    streamingText: text,
    thinkingText,
    toolCalls: toolCalls ?? [],
    progressText,
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
}: LLMStreamOutputProps) {
  const timelineForRender = useMemo<TimelineItem[]>(() => {
    if (timeline && timeline.length > 0) return timeline;

    const synthetic: TimelineItem[] = [];
    if (thinkingText) synthetic.push({ kind: "thinking", id: "live-thinking" });
    if (toolCalls && toolCalls.length > 0) {
      for (const tc of toolCalls) {
        synthetic.push({ kind: "tool", toolCallId: tc.id, id: `live-tool-${tc.id}` });
      }
    }
    if (text) synthetic.push({ kind: "text", content: text, id: "live-text" });
    return synthetic;
  }, [timeline, thinkingText, toolCalls, text]);

  return (
    <>
      <LLMOutput
        content={text}
        timeline={timelineForRender}
        toolCalls={toolCalls}
        thinkingText={thinkingText}
        thinkingDurationMs={thinkingDurationMs}
        artifactRefs={artifactRefs}
        isStreaming={isStreaming}
      />
      <StreamingIndicator
        isStreaming={isStreaming}
        text={text}
        thinkingText={thinkingText}
        toolCalls={toolCalls}
        progressText={progressText}
      />
    </>
  );
}
