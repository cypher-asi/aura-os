import { useMemo } from "react";
import type { ProcessEvent } from "../../../../types";
import type { TimelineItem, ToolCallEntry } from "../../../../types/stream";
import { LLMOutput } from "../../../../components/LLMOutput";
import { buildTimelineWithToolCalls } from "../../../../utils/build-timeline";

interface Props {
  event: ProcessEvent;
}

export function ProcessEventOutput({ event }: Props) {
  const parsed = useMemo(() => parseProcessEvent(event), [event]);
  if (!parsed) return null;
  return (
    <LLMOutput
      content={parsed.content}
      timeline={parsed.timeline}
      toolCalls={parsed.toolCalls}
      thinkingText={parsed.thinkingText}
    />
  );
}

function parseProcessEvent(event: ProcessEvent): {
  content: string;
  timeline: TimelineItem[];
  toolCalls: ToolCallEntry[];
  thinkingText: string;
} | null {
  const hasBlocks = !!event.content_blocks && event.content_blocks.length > 0;
  const { timeline, toolCalls, thinkingText } = hasBlocks
    ? buildTimelineWithToolCalls(event.content_blocks!, {
        fallbackContent: event.output || undefined,
      })
    : { timeline: [] as TimelineItem[], toolCalls: [] as ToolCallEntry[], thinkingText: "" };

  // Ensure event.output still appears when blocks only contain tools/thinking.
  if (
    event.output &&
    timeline.length > 0 &&
    !timeline.some((item) => item.kind === "text")
  ) {
    timeline.push({
      kind: "text",
      content: event.output,
      id: "node-output",
    });
  }

  const hasContent = !!(event.output || timeline.length > 0 || thinkingText);
  if (!hasContent) return null;

  return {
    content: event.output || "",
    timeline,
    toolCalls,
    thinkingText,
  };
}
