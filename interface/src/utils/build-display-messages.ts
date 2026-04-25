import type { SessionEvent, ChatContentBlock } from "../shared/types";
import type { DisplaySessionEvent } from "../shared/types/stream";
import { extractToolCalls, extractArtifactRefs } from "./chat-history";
import { buildTimelineFromBlocks } from "./build-timeline";

function isTextOrImage(b: ChatContentBlock): b is Extract<ChatContentBlock, { type: "text" } | { type: "image" }> {
  return b.type === "text" || b.type === "image";
}

export function buildDisplayEvents(msgs: SessionEvent[]): DisplaySessionEvent[] {
  return msgs
    .filter((m) => {
      if (m.content && m.content.trim().length > 0) return true;
      if (m.content_blocks && m.content_blocks.length > 0) return true;
      if (m.thinking) return true;
      if (m.role === "assistant" && m.thinking_duration_ms) return true;
      return false;
    })
    .map((m) => {
      const allBlocks = m.content_blocks ?? [];
      const displayBlocks = allBlocks
        .filter(isTextOrImage)
        .map((b) =>
          b.type === "text"
            ? { type: "text" as const, text: b.text }
            : { type: "image" as const, media_type: b.media_type, data: b.data },
        );
      const thinking = m.thinking || undefined;
      return {
        id: m.event_id,
        role: m.role,
        content: m.content,
        contentBlocks: displayBlocks.length > 0 ? displayBlocks : undefined,
        toolCalls: extractToolCalls(allBlocks),
        artifactRefs: extractArtifactRefs(allBlocks),
        thinkingText: thinking,
        thinkingDurationMs: m.thinking_duration_ms ?? null,
        timeline:
          m.role === "assistant"
            ? buildTimelineFromBlocks(allBlocks, thinking, m.content)
            : undefined,
        inFlight: m.in_flight ?? undefined,
      };
    });
}
