import { useMemo, useState, useCallback } from "react";
import { Copy, Check } from "lucide-react";
import type { ProcessEvent } from "../../../../types";
import type { DisplaySessionEvent } from "../../../../types/stream";
import { MessageBubble } from "../../../../components/MessageBubble";
import {
  contentBlocksToTimeline,
  formatOutputContent,
  prettyPrintIfJson,
  monoBox,
} from "../NodeOutputTab/node-output-utils";

interface Props {
  event: ProcessEvent;
}

export function ProcessEventOutput({ event }: Props) {
  const { message, separateOutput } = useMemo(
    () => buildEventDisplay(event),
    [event],
  );

  return (
    <>
      {message && <MessageBubble message={message} />}
      {separateOutput && <FormattedOutput text={separateOutput} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// FormattedOutput — scrollable, monospace block for structured data
// ---------------------------------------------------------------------------

function FormattedOutput({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const formatted = useMemo(() => prettyPrintIfJson(text), [text]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [formatted]);

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={handleCopy}
        title="Copy output"
        style={{
          position: "absolute",
          top: 4,
          right: 4,
          display: "flex",
          alignItems: "center",
          gap: 3,
          background: "var(--color-bg-secondary, rgba(0,0,0,0.3))",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-sm)",
          padding: "2px 6px",
          cursor: "pointer",
          fontSize: 10,
          color: "var(--color-text-muted)",
          zIndex: 1,
        }}
      >
        {copied ? <Check size={10} /> : <Copy size={10} />}
        {copied ? "Copied" : "Copy"}
      </button>
      <div style={monoBox}>{formatted}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Display-model builder
// ---------------------------------------------------------------------------

function looksLikeStructuredData(text: string): boolean {
  const t = text.trim();
  return t.startsWith("{") || t.startsWith("[");
}

function collectBlockRawText(
  blocks: ProcessEvent["content_blocks"],
): string {
  if (!blocks) return "";
  return blocks
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("");
}

/**
 * Build the display model: a conversation message (from content_blocks) and/or
 * a separate structured-data output (from event.output when it contains
 * distinct downstream data such as a file the agent wrote).
 */
function buildEventDisplay(event: ProcessEvent): {
  message: DisplaySessionEvent | null;
  separateOutput: string | null;
} {
  const hasBlocks =
    !!event.content_blocks && event.content_blocks.length > 0;
  const rawOutput = event.output?.trim() ?? "";

  if (!hasBlocks && !rawOutput) {
    return { message: null, separateOutput: null };
  }

  // -- No content blocks: render output directly --
  if (!hasBlocks) {
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

  // -- Has content blocks: build conversation timeline --
  const { timeline, toolCalls, thinkingText } = contentBlocksToTimeline(
    event.content_blocks!,
  );
  const blockRawText = collectBlockRawText(event.content_blocks);

  // If the only meaningful content is a single JSON blob (no tools / thinking),
  // render it in the dedicated FormattedOutput instead of the markdown pipeline.
  if (
    !thinkingText &&
    toolCalls.length === 0 &&
    timeline.length <= 1 &&
    looksLikeStructuredData(blockRawText)
  ) {
    return { message: null, separateOutput: blockRawText };
  }

  // Determine whether event.output is distinct downstream data
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
