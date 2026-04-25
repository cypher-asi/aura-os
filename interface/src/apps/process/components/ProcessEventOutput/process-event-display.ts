import type { ProcessEvent } from "../../../../types";
import type { DisplaySessionEvent } from "../../../../types/stream";
import {
  contentBlocksToTimeline,
  formatOutputContent,
} from "../NodeOutputTab/node-output-utils";

function looksLikeStructuredData(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function collectBlockRawText(
  blocks: ProcessEvent["content_blocks"],
): string {
  if (!blocks) return "";
  return blocks
    .map((block) => (block.type === "text" ? block.text : undefined))
    .filter((text): text is string => typeof text === "string" && text.length > 0)
    .join("");
}

export function buildProcessEventDisplay(event: ProcessEvent): {
  message: DisplaySessionEvent | null;
  separateOutput: string | null;
} {
  const contentBlocks =
    event.content_blocks && event.content_blocks.length > 0
      ? event.content_blocks
      : null;
  const rawOutput = event.output?.trim() ?? "";

  if (!contentBlocks && !rawOutput) {
    return { message: null, separateOutput: null };
  }

  if (!contentBlocks) {
    if (looksLikeStructuredData(rawOutput)) {
      return { message: null, separateOutput: rawOutput };
    }

    const formatted = formatOutputContent(rawOutput);
    return {
      message: {
        id: event.event_id,
        role: "assistant",
        content: formatted,
        timeline: [
          { kind: "text" as const, content: formatted, id: "node-output" },
        ],
      },
      separateOutput: null,
    };
  }

  const { timeline, toolCalls, thinkingText } = contentBlocksToTimeline(
    contentBlocks,
    {
      terminalStatus:
        event.status === "completed" || event.status === "failed" || event.status === "skipped"
          ? event.status
          : undefined,
    },
  );
  const blockRawText = collectBlockRawText(contentBlocks);

  if (
    !thinkingText &&
    toolCalls.length === 0 &&
    timeline.length <= 1 &&
    looksLikeStructuredData(blockRawText)
  ) {
    return { message: null, separateOutput: blockRawText };
  }

  let separateOutput: string | null = null;
  if (rawOutput && rawOutput.length >= 20) {
    const outputMatchesBlocks =
      blockRawText.includes(rawOutput) ||
      rawOutput.includes(blockRawText.trim());

    if (!outputMatchesBlocks) {
      if (looksLikeStructuredData(rawOutput)) {
        separateOutput = rawOutput;
      } else {
        timeline.push({
          kind: "text",
          content: formatOutputContent(rawOutput),
          id: "node-output",
        });
      }
    }
  }

  const hasTimeline = timeline.length > 0 || !!thinkingText;
  const message: DisplaySessionEvent | null = hasTimeline
    ? {
        id: event.event_id,
        role: "assistant",
        content: "",
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        thinkingText: thinkingText || undefined,
        timeline: timeline.length > 0 ? timeline : undefined,
      }
    : null;

  return { message, separateOutput };
}
