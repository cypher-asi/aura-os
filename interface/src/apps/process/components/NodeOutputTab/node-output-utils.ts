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

/**
 * Try to extract a valid JSON value from text that may have trailing
 * punctuation (commas, semicolons) or surrounding prose.
 */
function tryParseJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;

  // Try as-is first, then strip trailing non-JSON characters
  for (const candidate of [trimmed, trimmed.replace(/[,;\s]+$/, "")]) {
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }
  return undefined;
}

/**
 * Detect raw JSON strings and wrap them in a fenced code block so
 * downstream markdown renderers display them with proper formatting
 * and syntax highlighting. Non-JSON text is returned as-is.
 */
export function formatOutputContent(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return text;

  const parsed = tryParseJson(trimmed);
  if (parsed !== undefined) {
    return "```json\n" + JSON.stringify(parsed, null, 2) + "\n```";
  }

  return text;
}

/**
 * Pretty-print a string if it looks like JSON, for monospace/pre-wrap blocks.
 */
export function prettyPrintIfJson(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return text;

  const parsed = tryParseJson(trimmed);
  if (parsed !== undefined) {
    return JSON.stringify(parsed, null, 2);
  }

  return text;
}

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
        content: formatOutputContent(block.text),
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
