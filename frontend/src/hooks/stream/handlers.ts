import type { MutableRefObject } from "react";
import { isInsufficientCreditsError, dispatchInsufficientCredits } from "../../api/client";
import type {
  ToolCallStartedInfo,
  ToolCallSnapshotInfo,
  ToolCallInfo,
  ToolResultInfo,
} from "../../api/streams";
import type { Message, ChatContentBlock } from "../../types";
import { extractToolCalls, extractArtifactRefs } from "../../utils/chat-history";
import type {
  DisplayContentBlockUnion,
  ToolCallEntry,
  TimelineItem,
  StreamRefs,
  StreamSetters,
} from "../../types/stream";

/* ------------------------------------------------------------------ */
/*  Pure helpers                                                       */
/* ------------------------------------------------------------------ */

export function snapshotThinking(refs: StreamRefs) {
  return {
    savedThinking: refs.thinkingBuffer.current || undefined,
    savedThinkingDuration: refs.thinkingStart.current != null
      ? Date.now() - refs.thinkingStart.current
      : null,
  };
}

export function snapshotToolCalls(refs: StreamRefs): ToolCallEntry[] | undefined {
  return refs.toolCalls.current.length > 0
    ? [...refs.toolCalls.current]
    : undefined;
}

export function snapshotTimeline(refs: StreamRefs): TimelineItem[] | undefined {
  return refs.timeline.current.length > 0
    ? [...refs.timeline.current]
    : undefined;
}

export function resetStreamBuffers(refs: StreamRefs, setters: StreamSetters): void {
  setters.setStreamingText("");
  refs.streamBuffer.current = "";
  setters.setThinkingText("");
  refs.thinkingBuffer.current = "";
  refs.thinkingStart.current = null;
  setters.setThinkingDurationMs(null);
  refs.toolCalls.current = [];
  setters.setActiveToolCalls([]);
  refs.timeline.current = [];
  setters.setTimeline([]);
  setters.setProgressText("");
}

let _tlId = 0;
function nextTimelineId(): string {
  return `tl-${++_tlId}`;
}

/* ------------------------------------------------------------------ */
/*  Stream event handlers                                              */
/* ------------------------------------------------------------------ */

export function handleThinkingDelta(
  refs: StreamRefs,
  setters: StreamSetters,
  text: string,
): void {
  setters.setProgressText("");
  if (refs.thinkingStart.current === null) {
    refs.thinkingStart.current = Date.now();
  }
  refs.thinkingBuffer.current += text;

  const tl = refs.timeline.current;
  if (tl.length === 0 || tl[tl.length - 1].kind !== "thinking") {
    tl.push({ kind: "thinking", id: nextTimelineId() });
  }

  if (refs.thinkingRaf.current === null) {
    refs.thinkingRaf.current = requestAnimationFrame(() => {
      refs.thinkingRaf.current = null;
      setters.setThinkingText(refs.thinkingBuffer.current);
      setters.setTimeline([...refs.timeline.current]);
    });
  }
}

export function handleTextDelta(
  refs: StreamRefs,
  setters: StreamSetters,
  closureThinkingDurationMs: number | null,
  text: string,
): void {
  setters.setProgressText("");
  if (refs.thinkingStart.current !== null && closureThinkingDurationMs === null) {
    setters.setThinkingDurationMs(Date.now() - refs.thinkingStart.current);
  }
  if (refs.needsSeparator.current && refs.streamBuffer.current.length > 0) {
    refs.streamBuffer.current += "\n\n";
    refs.needsSeparator.current = false;
  }
  refs.streamBuffer.current += text;

  const tl = refs.timeline.current;
  const last = tl.length > 0 ? tl[tl.length - 1] : null;
  if (last && last.kind === "text") {
    last.content += text;
  } else {
    tl.push({ kind: "text", content: text, id: nextTimelineId() });
  }

  if (refs.raf.current === null) {
    refs.raf.current = requestAnimationFrame(() => {
      refs.raf.current = null;
      setters.setStreamingText(refs.streamBuffer.current);
      setters.setTimeline(refs.timeline.current.map((i) => ({ ...i } as TimelineItem)));
    });
  }
}

export function handleToolCallStarted(
  refs: StreamRefs,
  setters: StreamSetters,
  info: ToolCallStartedInfo,
): void {
  const entry: ToolCallEntry = {
    id: info.id,
    name: info.name,
    input: {},
    pending: true,
    started: true,
  };
  refs.toolCalls.current = [...refs.toolCalls.current, entry];
  setters.setActiveToolCalls([...refs.toolCalls.current]);

  refs.timeline.current.push({ kind: "tool", toolCallId: info.id, id: nextTimelineId() });
  setters.setTimeline([...refs.timeline.current]);
}

export function handleToolCallSnapshot(
  refs: StreamRefs,
  setters: StreamSetters,
  info: ToolCallSnapshotInfo,
): void {
  const idx = refs.toolCalls.current.findIndex((tc) => tc.id === info.id);
  if (idx === -1) {
    refs.toolCalls.current = [
      ...refs.toolCalls.current,
      {
        id: info.id,
        name: info.name,
        input: info.input,
        pending: true,
        started: true,
      },
    ];
    refs.timeline.current.push({ kind: "tool", toolCallId: info.id, id: nextTimelineId() });
    setters.setTimeline([...refs.timeline.current]);
    setters.setActiveToolCalls([...refs.toolCalls.current]);
    return;
  }

  refs.toolCalls.current = refs.toolCalls.current.map((tc) =>
    tc.id === info.id
      ? {
        ...tc,
        name: info.name,
        input: { ...tc.input, ...info.input },
      }
      : tc,
  );
  setters.setActiveToolCalls([...refs.toolCalls.current]);
}

export function handleToolCall(
  refs: StreamRefs,
  setters: StreamSetters,
  info: ToolCallInfo,
): void {
  const existingIdx = refs.toolCalls.current.findIndex((tc) => tc.id === info.id);
  if (existingIdx !== -1) {
    const existing = refs.toolCalls.current[existingIdx];
    const existingMarkdown = typeof existing.input.markdown_contents === "string"
      ? (existing.input.markdown_contents as string)
      : "";
    const incomingMarkdown = typeof info.input.markdown_contents === "string"
      ? (info.input.markdown_contents as string)
      : undefined;
    let mergedMarkdown = existingMarkdown;
    if (incomingMarkdown !== undefined) {
      if (!existingMarkdown || incomingMarkdown.startsWith(existingMarkdown) || incomingMarkdown.length >= existingMarkdown.length) {
        mergedMarkdown = incomingMarkdown;
      } else {
        mergedMarkdown = existingMarkdown + incomingMarkdown;
      }
    }
    const mergedInput: Record<string, unknown> = { ...existing.input, ...info.input };
    if (incomingMarkdown !== undefined) {
      mergedInput.markdown_contents = mergedMarkdown;
    }
    refs.toolCalls.current = refs.toolCalls.current.map((tc) =>
      tc.id === info.id
        ? { ...tc, name: info.name, input: mergedInput, started: false }
        : tc,
    );
  } else {
    const entry: ToolCallEntry = {
      id: info.id,
      name: info.name,
      input: info.input,
      pending: true,
    };
    refs.toolCalls.current = [...refs.toolCalls.current, entry];

    refs.timeline.current.push({ kind: "tool", toolCallId: info.id, id: nextTimelineId() });
    setters.setTimeline([...refs.timeline.current]);
  }
  setters.setActiveToolCalls([...refs.toolCalls.current]);
}

export function handleToolResult(
  refs: StreamRefs,
  setters: StreamSetters,
  info: ToolResultInfo,
): void {
  let targetIndex = -1;
  if (info.id) {
    targetIndex = refs.toolCalls.current.findIndex((tc) => tc.id === info.id);
  } else {
    // Harness protocol may omit tool-use ids on tool_result; in that case,
    // resolve the most recent pending call with the same tool name.
    for (let i = refs.toolCalls.current.length - 1; i >= 0; i--) {
      const tc = refs.toolCalls.current[i];
      if (tc.pending && tc.name === info.name) {
        targetIndex = i;
        break;
      }
    }
  }

  if (targetIndex !== -1) {
    refs.toolCalls.current = refs.toolCalls.current.map((tc, idx) =>
      idx === targetIndex
        ? { ...tc, result: info.result, isError: info.is_error, pending: false, started: false }
        : tc,
    );
  }
  setters.setActiveToolCalls([...refs.toolCalls.current]);
  refs.needsSeparator.current = true;
}

function isTextOrImage(b: ChatContentBlock): b is Extract<ChatContentBlock, { type: "text" } | { type: "image" }> {
  return b.type === "text" || b.type === "image";
}

export function handleMessageSaved(
  refs: StreamRefs,
  setters: StreamSetters,
  msg: Message,
): void {
  const allBlocks = msg.content_blocks ?? [];
  const displayBlocks: DisplayContentBlockUnion[] = allBlocks
    .filter(isTextOrImage)
    .map((b) =>
      b.type === "text"
        ? { type: "text" as const, text: b.text }
        : { type: "image" as const, media_type: b.media_type, data: b.data },
    );

  const msgToolCalls = extractToolCalls(allBlocks);
  const finalToolCalls =
    msgToolCalls && msgToolCalls.length > 0
      ? msgToolCalls
      : snapshotToolCalls(refs);

  const savedThinking = msg.thinking || refs.thinkingBuffer.current || undefined;
  const savedThinkingDuration = msg.thinking_duration_ms
    ?? (refs.thinkingStart.current != null ? Date.now() - refs.thinkingStart.current : null);
  setters.setMessages((prev) => [
    ...prev,
    {
      id: msg.message_id,
      role: "assistant",
      content: msg.content,
      contentBlocks: displayBlocks.length > 0 ? displayBlocks : undefined,
      toolCalls: finalToolCalls,
      artifactRefs: extractArtifactRefs(allBlocks),
      thinkingText: savedThinking,
      thinkingDurationMs: savedThinkingDuration,
      timeline: snapshotTimeline(refs),
    },
  ]);
  resetStreamBuffers(refs, setters);
}

/**
 * Lightweight handler for AssistantMessageEnd during a harness stream.
 * Saves the current text buffer as a message but does NOT abort the SSE
 * connection or clear tool calls — tool_result events and subsequent agent
 * loop iterations arrive AFTER assistant_message_end.
 */
export function handleAssistantTurnBoundary(
  refs: StreamRefs,
  setters: StreamSetters,
): void {
  const hasBuffer = !!refs.streamBuffer.current;
  if (hasBuffer) {
    const { savedThinking, savedThinkingDuration } = snapshotThinking(refs);
    setters.setMessages((prev) => [
      ...prev,
      {
        id: `stream-${Date.now()}`,
        role: "assistant",
        content: refs.streamBuffer.current,
        toolCalls: snapshotToolCalls(refs),
        thinkingText: savedThinking,
        thinkingDurationMs: savedThinkingDuration,
        timeline: snapshotTimeline(refs),
      },
    ]);
    setters.setStreamingText("");
    refs.streamBuffer.current = "";
    setters.setThinkingText("");
    refs.thinkingBuffer.current = "";
    refs.thinkingStart.current = null;
    setters.setThinkingDurationMs(null);
    refs.needsSeparator.current = false;
  }
}

function failPendingToolCalls(refs: StreamRefs, reason: string): void {
  const hasPending = refs.toolCalls.current.some((tc) => tc.pending);
  if (!hasPending) return;
  refs.toolCalls.current = refs.toolCalls.current.map((tc) =>
    tc.pending
      ? { ...tc, pending: false, started: false, isError: true, result: reason }
      : tc,
  );
}

export function handleStreamError(
  refs: StreamRefs,
  setters: StreamSetters,
  message: string,
): void {
  console.error("Chat stream error:", message);
  if (isInsufficientCreditsError(message)) {
    dispatchInsufficientCredits();
  }
  failPendingToolCalls(refs, `Stream error: ${message}`);
  setters.setActiveToolCalls([...refs.toolCalls.current]);

  const { savedThinking, savedThinkingDuration } = snapshotThinking(refs);
  const prefix = refs.streamBuffer.current
    ? refs.streamBuffer.current + "\n\n"
    : "";
  setters.setMessages((prev) => [
    ...prev,
    {
      id: `error-${Date.now()}`,
      role: "assistant",
      content: prefix + `*Error: ${message}*`,
      toolCalls: snapshotToolCalls(refs),
      thinkingText: savedThinking,
      thinkingDurationMs: savedThinkingDuration,
      timeline: snapshotTimeline(refs),
    },
  ]);
  resetStreamBuffers(refs, setters);
}

export function finalizeStream(
  refs: StreamRefs,
  setters: StreamSetters,
  abortRef: MutableRefObject<AbortController | null>,
  closureIsStreaming: boolean,
): void {
  failPendingToolCalls(refs, "Connection lost before result was received");
  setters.setActiveToolCalls([...refs.toolCalls.current]);

  const hasBuffer = !!refs.streamBuffer.current;

  if (hasBuffer && !closureIsStreaming) {
    const { savedThinking, savedThinkingDuration } = snapshotThinking(refs);
    setters.setMessages((prev) => [
      ...prev,
      {
        id: `stream-${Date.now()}`,
        role: "assistant",
        content: refs.streamBuffer.current,
        toolCalls: snapshotToolCalls(refs),
        thinkingText: savedThinking,
        thinkingDurationMs: savedThinkingDuration,
        timeline: snapshotTimeline(refs),
      },
    ]);
    setters.setStreamingText("");
    refs.streamBuffer.current = "";
    refs.toolCalls.current = [];
    setters.setActiveToolCalls([]);
    refs.timeline.current = [];
    setters.setTimeline([]);
    setters.setThinkingText("");
    refs.thinkingBuffer.current = "";
    refs.thinkingStart.current = null;
    setters.setThinkingDurationMs(null);
  } else if (!hasBuffer && !refs.thinkingBuffer.current) {
    setters.setThinkingText("");
    refs.thinkingBuffer.current = "";
    refs.thinkingStart.current = null;
    setters.setThinkingDurationMs(null);
  }
  // When hasBuffer is true but closureIsStreaming prevents saving,
  // preserve thinking so it is included when the message is saved
  // on the subsequent call (e.g. onDone after AssistantMessageEnd).

  setters.setProgressText("");
  setters.setIsStreaming(false);
  abortRef.current?.abort();
  abortRef.current = null;
}
