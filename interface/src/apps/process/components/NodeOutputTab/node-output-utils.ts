import type { ProcessEventContentBlock } from "../../../../types";
import type { ToolCallEntry, TimelineItem } from "../../../../types/stream";

export const monoBox: React.CSSProperties = {
  background: "var(--color-bg-input)",
  padding: 8,
  borderRadius: "var(--radius-sm)",
  whiteSpace: "pre-wrap",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
  maxHeight: 400,
  overflow: "auto",
  lineHeight: 1.5,
  color: "var(--color-text)",
};

export function contentBlocksToTimeline(blocks: ProcessEventContentBlock[]): {
  timeline: TimelineItem[];
  toolCalls: ToolCallEntry[];
  thinkingText: string;
} {
  const timeline: TimelineItem[] = [];
  const toolCalls: ToolCallEntry[] = [];
  let thinkingText = "";
  const toolCallMap = new Map<string, ToolCallEntry>();

  for (const block of blocks) {
    if (block.type === "text" && block.text) {
      timeline.push({
        kind: "text",
        content: block.text,
        id: `text-${timeline.length}`,
      });
    } else if (block.type === "thinking" && block.thinking) {
      thinkingText += (thinkingText ? "\n" : "") + block.thinking;
      if (!timeline.some((t) => t.kind === "thinking")) {
        timeline.push({ kind: "thinking", id: "thinking-0" });
      }
    } else if (block.type === "tool_use" && block.name) {
      const id = block.id ?? `tool-${timeline.length}`;
      const entry: ToolCallEntry = {
        id,
        name: block.name,
        input: {},
        pending: true,
      };
      toolCallMap.set(id, entry);
      toolCalls.push(entry);
      timeline.push({ kind: "tool", toolCallId: id, id: `tool-${id}` });
    } else if (block.type === "tool_result") {
      const matchId = block.tool_use_id ?? "";
      const entry =
        toolCallMap.get(matchId) ?? toolCalls[toolCalls.length - 1];
      if (entry) {
        entry.result = block.result ?? "";
        entry.isError = block.is_error ?? false;
        entry.pending = false;
      }
    }
  }

  return { timeline, toolCalls, thinkingText };
}
