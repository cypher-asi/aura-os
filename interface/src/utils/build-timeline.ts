import type { ChatContentBlock, ProcessEventContentBlock } from "../shared/types";
import type { TimelineItem, ToolCallEntry } from "../shared/types/stream";
import { normalizeToolInput } from "./tool-input";

let _btlId = 0;
function nextId(): string {
  return `btl-${++_btlId}`;
}

/** A content block from either chat history or process events. */
export type AnyContentBlock = ChatContentBlock | ProcessEventContentBlock;

export interface BuildTimelineResult {
  timeline: TimelineItem[];
  toolCalls: ToolCallEntry[];
  thinkingText: string;
}

/**
 * Build a timeline, tool call entries, and thinking text from content blocks.
 *
 * Handles both ChatContentBlock[] (from chat history) and
 * ProcessEventContentBlock[] (from process events). The difference:
 * - Chat blocks have required `id` and `input` on tool_use.
 * - Process blocks have optional `id`, no input, and separate `thinking` blocks.
 *
 * If `thinking` parameter is provided, it's used as thinking text (chat path).
 * If blocks contain `thinking` type entries, those are accumulated (process path).
 */
export function buildTimelineWithToolCalls(
  blocks: AnyContentBlock[],
  options?: {
    thinking?: string;
    fallbackContent?: string;
  },
): BuildTimelineResult {
  const timeline: TimelineItem[] = [];
  const toolCalls: ToolCallEntry[] = [];
  const toolCallMap = new Map<string, ToolCallEntry>();
  let thinkingText = options?.thinking ?? "";

  if (thinkingText) {
    timeline.push({ kind: "thinking", id: nextId() });
  }

  let hasText = false;
  for (const block of blocks) {
    if (block.type === "text") {
      const text = ("text" in block ? block.text : undefined) ?? "";
      if (text || !thinkingText) {
        timeline.push({ kind: "text", content: text, id: nextId() });
      }
      if (text) hasText = true;
    } else if (block.type === "thinking" && "thinking" in block && block.thinking) {
      // Process event thinking blocks
      thinkingText += (thinkingText ? "\n" : "") + block.thinking;
      if (!timeline.some((t) => t.kind === "thinking")) {
        timeline.push({ kind: "thinking", id: nextId() });
      }
    } else if (block.type === "tool_use") {
      const toolId = ("id" in block ? block.id : undefined) ?? `tool-${timeline.length}`;
      if (!toolId) continue;
      const input = normalizeToolInput("input" in block ? block.input : undefined);
      const entry: ToolCallEntry = {
        id: toolId,
        name: ("name" in block ? block.name : undefined) ?? "",
        input,
        pending: true,
      };
      toolCallMap.set(toolId, entry);
      toolCalls.push(entry);
      timeline.push({ kind: "tool", toolCallId: toolId, id: nextId() });
    } else if (block.type === "tool_result") {
      const matchId = ("tool_use_id" in block ? block.tool_use_id : undefined) ?? "";
      const entry = toolCallMap.get(matchId) ?? toolCalls[toolCalls.length - 1];
      if (entry) {
        const resultContent = ("content" in block ? block.content : undefined)
          ?? ("result" in block ? (block as ProcessEventContentBlock).result : undefined)
          ?? "";
        entry.result = resultContent;
        entry.isError = ("is_error" in block ? block.is_error : undefined) ?? false;
        entry.pending = false;
      }
    }
  }

  if (!hasText && options?.fallbackContent) {
    timeline.push({ kind: "text", content: options.fallbackContent, id: nextId() });
  }

  return { timeline, toolCalls, thinkingText };
}

/**
 * Build a timeline from content blocks (backward-compatible wrapper).
 *
 * Returns only the TimelineItem[] for callers that extract tool calls separately.
 */
export function buildTimelineFromBlocks(
  blocks: ChatContentBlock[],
  thinking: string | undefined,
  fallbackContent?: string,
): TimelineItem[] {
  return buildTimelineWithToolCalls(blocks, { thinking, fallbackContent }).timeline;
}
