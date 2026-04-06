import { useMemo } from "react";
import type { ProcessEvent } from "../../../../types";
import type { DisplaySessionEvent, TimelineItem } from "../../../../types/stream";
import { MessageBubble } from "../../../../components/MessageBubble";
import { contentBlocksToTimeline, formatOutputContent } from "../NodeOutputTab/node-output-utils";

interface Props {
  event: ProcessEvent;
}

export function ProcessEventOutput({ event }: Props) {
  const message = useMemo(() => processEventToMessage(event), [event]);
  if (!message) return null;
  return <MessageBubble message={message} />;
}

function processEventToMessage(event: ProcessEvent): DisplaySessionEvent | null {
  const hasBlocks = !!event.content_blocks && event.content_blocks.length > 0;
  const { timeline, toolCalls, thinkingText } = hasBlocks
    ? contentBlocksToTimeline(event.content_blocks!)
    : { timeline: [] as TimelineItem[], toolCalls: [], thinkingText: "" };

  const formattedOutput = event.output ? formatOutputContent(event.output) : "";

  // Append event.output to the timeline when it adds information beyond what
  // the content_blocks already contain (e.g. downstream file output that
  // differs from the streamed conversation text).
  if (formattedOutput && timeline.length > 0) {
    const existingText = timeline
      .filter((item): item is TimelineItem & { kind: "text" } => item.kind === "text")
      .map((item) => item.content)
      .join("");
    const outputAlreadyPresent =
      existingText.includes(event.output!.trim()) ||
      event.output!.trim().length < 20;
    if (!outputAlreadyPresent) {
      timeline.push({
        kind: "text",
        content: formattedOutput,
        id: "node-output",
      });
    }
  } else if (formattedOutput && timeline.length === 0) {
    timeline.push({
      kind: "text",
      content: formattedOutput,
      id: "node-output",
    });
  }

  const hasContent = !!(formattedOutput || timeline.length > 0 || thinkingText);
  if (!hasContent) return null;

  return {
    id: event.event_id,
    role: "assistant",
    content: formattedOutput,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    thinkingText: thinkingText || undefined,
    timeline: timeline.length > 0 ? timeline : undefined,
  };
}
