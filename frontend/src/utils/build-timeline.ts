import type { ChatContentBlock } from "../types";
import type { TimelineItem } from "../types/stream";

let _btlId = 0;
function nextId(): string {
  return `btl-${++_btlId}`;
}

/**
 * Reconstruct a timeline from a completed message's content blocks.
 *
 * Used when loading messages from history (where no live streaming
 * timeline was captured). Iterates blocks in order and maps:
 *   - "text"        -> {kind:"text"}
 *   - "tool_use"    -> {kind:"tool"}
 *   - "tool_result" -> skip (the tool entry already covers it)
 *   - others        -> skip
 *
 * If thinking text exists, a thinking item is prepended.
 * If no text blocks were found, a fallback text item is appended
 * from the message content string.
 */
export function buildTimelineFromBlocks(
  blocks: ChatContentBlock[],
  thinking: string | undefined,
  fallbackContent?: string,
): TimelineItem[] {
  const items: TimelineItem[] = [];

  if (thinking) {
    items.push({ kind: "thinking", id: nextId() });
  }

  let hasText = false;
  for (const block of blocks) {
    if (block.type === "text") {
      items.push({ kind: "text", content: block.text, id: nextId() });
      hasText = true;
    } else if (block.type === "tool_use") {
      items.push({ kind: "tool", toolCallId: block.id, id: nextId() });
    }
  }

  if (!hasText && fallbackContent) {
    items.push({ kind: "text", content: fallbackContent, id: nextId() });
  }

  return items;
}
