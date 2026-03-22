import type { MutableRefObject } from "react";
import { isInsufficientCreditsError, dispatchInsufficientCredits } from "../../api/client";
import type { ToolCallStartedInfo, ToolCallDeltaInfo, ToolCallInfo, ToolResultInfo } from "../../api/streams";
import type { Message } from "../../types";
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
  refs.toolInputBuffers.current.clear();
  if (refs.toolCallRaf.current !== null) {
    cancelAnimationFrame(refs.toolCallRaf.current);
    refs.toolCallRaf.current = null;
  }
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

function tryParseToolInput(buf: string): Record<string, unknown> | null {
  for (const suffix of ["", '"}',"'}", '"}]']) {
    try {
      return JSON.parse(buf + suffix) as Record<string, unknown>;
    } catch { /* try next */ }
  }
  return null;
}

export function handleToolCallDelta(
  refs: StreamRefs,
  setters: StreamSetters,
  info: ToolCallDeltaInfo,
): void {
  const buffers = refs.toolInputBuffers.current;
  const prev = buffers.get(info.id) ?? "";
  buffers.set(info.id, prev + info.partialInput);

  if (refs.toolCallRaf.current === null) {
    refs.toolCallRaf.current = requestAnimationFrame(() => {
      refs.toolCallRaf.current = null;
      let changed = false;

      for (const [id, buf] of buffers) {
        const parsed = tryParseToolInput(buf);
        if (!parsed) continue;

        const idx = refs.toolCalls.current.findIndex((tc) => tc.id === id);
        if (idx === -1) continue;

        const existing = refs.toolCalls.current[idx];
        const mergedInput: Record<string, unknown> = { ...existing.input, ...parsed };
        refs.toolCalls.current = refs.toolCalls.current.map((tc) =>
          tc.id === id ? { ...tc, input: mergedInput } : tc,
        );
        changed = true;
      }

      if (changed) {
        setters.setActiveToolCalls([...refs.toolCalls.current]);
      }
    });
  }
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
  refs.toolCalls.current = refs.toolCalls.current.map((tc) =>
    tc.id === info.id
      ? { ...tc, result: info.result, isError: info.is_error, pending: false }
      : tc,
  );
  setters.setActiveToolCalls([...refs.toolCalls.current]);
  refs.needsSeparator.current = true;
}

export function handleMessageSaved(
  refs: StreamRefs,
  setters: StreamSetters,
  msg: Message,
): void {
  const allBlocks = msg.content_blocks ?? [];
  const displayBlocks: DisplayContentBlockUnion[] = allBlocks
    .filter((b) => b.type === "text" || b.type === "image")
    .map((b) =>
      b.type === "text"
        ? { type: "text" as const, text: b.text ?? "" }
        : { type: "image" as const, media_type: b.media_type ?? "image/png", data: b.data ?? "" },
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

export function handleStreamError(
  refs: StreamRefs,
  setters: StreamSetters,
  message: string,
): void {
  console.error("Chat stream error:", message);
  if (isInsufficientCreditsError(message)) {
    dispatchInsufficientCredits();
  }
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
  if (refs.streamBuffer.current && !closureIsStreaming) {
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
  }
  setters.setThinkingText("");
  refs.thinkingBuffer.current = "";
  refs.thinkingStart.current = null;
  setters.setThinkingDurationMs(null);
  setters.setProgressText("");
  setters.setIsStreaming(false);
  abortRef.current = null;
}
