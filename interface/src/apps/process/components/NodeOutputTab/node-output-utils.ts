import type { CSSProperties } from "react";
import type { ProcessEventContentBlock } from "../../../../shared/types";
import type { ToolCallEntry, TimelineItem } from "../../../../shared/types/stream";

type TerminalProcessStatus = "completed" | "failed" | "skipped";

interface ContentBlocksToTimelineOptions {
  terminalStatus?: TerminalProcessStatus;
}

export const monoBox: CSSProperties = {
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

export function getPendingToolFallbackResult(
  terminalStatus: TerminalProcessStatus,
): string {
  return terminalStatus === "failed"
    ? "Run failed before a tool result was persisted"
    : terminalStatus === "skipped"
      ? "Run was skipped before a tool result was persisted"
      : "Completed without a persisted tool result";
}

function finalizePendingToolCalls(
  toolCalls: ToolCallEntry[],
  terminalStatus?: TerminalProcessStatus,
): void {
  if (!terminalStatus) return;

  const fallbackResult = getPendingToolFallbackResult(terminalStatus);

  for (const toolCall of toolCalls) {
    if (!toolCall.pending) continue;
    toolCall.pending = false;
    toolCall.started = false;
    toolCall.isError = terminalStatus === "failed";
    toolCall.result = toolCall.result ?? fallbackResult;
  }
}

export function contentBlocksToTimeline(
  blocks: ProcessEventContentBlock[],
  options: ContentBlocksToTimelineOptions = {},
): {
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
    } else if (block.type === "tool_call_snapshot") {
      const id = block.id ?? "";
      const name = block.name ?? "tool";
      const input = block.input ?? {};
      const existing = id ? toolCallMap.get(id) : undefined;

      if (existing) {
        existing.name = name;
        existing.input = { ...existing.input, ...input };
      } else {
        const newId = id || `tool-${timeline.length}`;
        const entry: ToolCallEntry = {
          id: newId,
          name,
          input,
          pending: true,
          started: true,
        };
        toolCallMap.set(newId, entry);
        toolCalls.push(entry);
        timeline.push({ kind: "tool", toolCallId: newId, id: `tool-${newId}` });
      }
    } else if (block.type === "tool_result") {
      const matchId = block.tool_use_id ?? block.id ?? "";
      const entry =
        (matchId ? toolCallMap.get(matchId) : undefined) ??
        [...toolCalls].reverse().find((toolCall) => toolCall.pending && toolCall.name === block.name) ??
        [...toolCalls].reverse().find((toolCall) => toolCall.pending);
      if (entry) {
        entry.result = block.result ?? "";
        entry.isError = block.is_error ?? false;
        entry.pending = false;
        entry.started = false;
      }
    }
  }

  finalizePendingToolCalls(toolCalls, options.terminalStatus);

  return { timeline, toolCalls, thinkingText };
}
