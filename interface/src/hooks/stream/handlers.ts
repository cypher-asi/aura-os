import type { MutableRefObject } from "react";
import {
  isInsufficientCreditsError,
  isAgentBusyError,
  dispatchInsufficientCredits,
} from "../../api/client";
import type {
  ToolCallStartedInfo,
  ToolCallSnapshotInfo,
  ToolCallInfo,
  ToolResultInfo,
  ToolCallRetryingInfo,
  ToolCallFailedInfo,
} from "../../api/streams";
import type { SessionEvent, ChatContentBlock } from "../../types";
import { extractToolCalls, extractArtifactRefs } from "../../utils/chat-history";
import type {
  DisplayContentBlockUnion,
  DisplaySessionEvent,
  ToolCallEntry,
  TimelineItem,
  StreamRefs,
  StreamSetters,
} from "../../types/stream";
import { normalizeToolInput } from "../../utils/tool-input";

export type FinalizeStreamReason = "completed" | "failed" | "disconnected";

interface PendingToolResolution {
  isError: boolean;
  result?: string;
}

interface FinalizeStreamOptions {
  reason?: FinalizeStreamReason;
  message?: string;
}

const WORD_REVEAL_INITIAL_DELAY_MS = 16;
const WORD_REVEAL_INTERVAL_MS = 42;
const WORD_REVEAL_MEDIUM_BACKLOG_INTERVAL_MS = 24;
const WORD_REVEAL_LARGE_BACKLOG_INTERVAL_MS = 12;
const WORD_REVEAL_MAX_BACKLOG_INTERVAL_MS = 8;
const WORD_REVEAL_MEDIUM_BACKLOG_WORDS = 6;
const WORD_REVEAL_LARGE_BACKLOG_WORDS = 12;
const WORD_REVEAL_MAX_BACKLOG_WORDS = 24;
const MARKDOWN_LINE_PREFIX_RE = /^(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+|>\s+|#{1,6}\s+)/;
const CODE_FENCE_LINE_RE = /^(?:`{3,}|~{3,})[^\n]*(?:\n|$)/;

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

function getStreamErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

function normalizeStreamError(error: unknown): {
  message: string;
  displayVariant?: "insufficientCreditsError" | "agentBusyError";
} {
  if (isInsufficientCreditsError(error)) {
    return {
      message: "You have no credits remaining. Buy more credits to continue.",
      displayVariant: "insufficientCreditsError",
    };
  }

  if (isAgentBusyError(error)) {
    return {
      message:
        "This agent is currently running an automation task. Stop the automation to chat.",
      displayVariant: "agentBusyError",
    };
  }

  return {
    message: getStreamErrorMessage(error),
  };
}

function cancelPendingStreamFlush(refs: StreamRefs): void {
  if (refs.flushTimeout.current !== null) {
    clearTimeout(refs.flushTimeout.current);
    refs.flushTimeout.current = null;
  }
  if (refs.raf.current !== null) {
    cancelAnimationFrame(refs.raf.current);
    refs.raf.current = null;
  }
}

function getDisplayedStreamingText(refs: StreamRefs): string {
  return refs.streamBuffer.current.slice(0, refs.displayedTextLength.current);
}

/**
 * Walk the authoritative timeline in arrival order and clip each text item
 * to the still-revealing prefix. Non-text items (thinking, tool) pass
 * through unchanged; each text item consumes a slice of `visibleText`
 * equal to at most its stored content length, preserving linear order.
 */
function buildDisplayedTimeline(
  refs: StreamRefs,
  visibleText: string,
): TimelineItem[] {
  const displayedTimeline: TimelineItem[] = [];
  let remainingVisibleText = visibleText;

  for (const item of refs.timeline.current) {
    if (item.kind !== "text") {
      displayedTimeline.push({ ...item });
      continue;
    }

    if (!remainingVisibleText) continue;

    const visibleSegment = remainingVisibleText.slice(
      0,
      Math.min(item.content.length, remainingVisibleText.length),
    );
    remainingVisibleText = remainingVisibleText.slice(visibleSegment.length);
    if (visibleSegment.length > 0) {
      displayedTimeline.push({ ...item, content: visibleSegment });
    }
  }

  return displayedTimeline;
}

function updateWritingFlag(
  refs: StreamRefs,
  setters: StreamSetters,
): void {
  const writing =
    refs.displayedTextLength.current < refs.streamBuffer.current.length;
  setters.setIsWriting(writing);
}

function syncDisplayedTimeline(
  refs: StreamRefs,
  setters: StreamSetters,
): void {
  setters.setTimeline(buildDisplayedTimeline(refs, getDisplayedStreamingText(refs)));
}

function applyDisplayedStreamingState(
  refs: StreamRefs,
  setters: StreamSetters,
  displayedTextLength: number,
): void {
  refs.displayedTextLength.current = displayedTextLength;
  refs.lastTextFlushAt.current = Date.now();

  const visibleText = getDisplayedStreamingText(refs);
  setters.setStreamingText(visibleText);
  setters.setTimeline(buildDisplayedTimeline(refs, visibleText));
  updateWritingFlag(refs, setters);
}

function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

function getNextWordRevealIndex(buffer: string, start: number): number {
  if (start >= buffer.length) return buffer.length;

  let cursor = start;
  while (cursor < buffer.length && isWhitespace(buffer[cursor])) {
    cursor++;
  }
  if (cursor >= buffer.length) {
    return buffer.length;
  }

  const consumedLeadingWhitespace = buffer.slice(start, cursor);
  const isLineStart = start === 0
    || buffer[start - 1] === "\n"
    || consumedLeadingWhitespace.includes("\n");
  const remaining = buffer.slice(cursor);

  if (isLineStart) {
    const codeFenceMatch = remaining.match(CODE_FENCE_LINE_RE);
    if (codeFenceMatch) {
      return cursor + codeFenceMatch[0].length;
    }

    const markdownPrefixMatch = remaining.match(MARKDOWN_LINE_PREFIX_RE);
    if (markdownPrefixMatch) {
      cursor += markdownPrefixMatch[0].length;
    }
  }

  while (cursor < buffer.length && !isWhitespace(buffer[cursor])) {
    cursor++;
  }

  return cursor;
}

function getPendingRevealWordCount(refs: StreamRefs): number {
  const hiddenText = refs.streamBuffer.current.slice(refs.displayedTextLength.current);
  const matches = hiddenText.match(/\S+/g);
  return matches ? matches.length : 0;
}

function getWordRevealDelayMs(refs: StreamRefs): number {
  if (refs.displayedTextLength.current === 0) {
    return WORD_REVEAL_INITIAL_DELAY_MS;
  }

  const pendingWords = getPendingRevealWordCount(refs);
  if (pendingWords >= WORD_REVEAL_MAX_BACKLOG_WORDS) {
    return WORD_REVEAL_MAX_BACKLOG_INTERVAL_MS;
  }
  if (pendingWords >= WORD_REVEAL_LARGE_BACKLOG_WORDS) {
    return WORD_REVEAL_LARGE_BACKLOG_INTERVAL_MS;
  }
  if (pendingWords >= WORD_REVEAL_MEDIUM_BACKLOG_WORDS) {
    return WORD_REVEAL_MEDIUM_BACKLOG_INTERVAL_MS;
  }
  return WORD_REVEAL_INTERVAL_MS;
}

function queueStreamingTextReveal(
  refs: StreamRefs,
  setters: StreamSetters,
  mode: "step" | "full" = "step",
): void {
  if (refs.raf.current !== null) return;

  let ranSynchronously = false;
  const rafId = requestAnimationFrame(() => {
    ranSynchronously = true;
    refs.raf.current = null;
    const nextDisplayedLength = mode === "full"
      ? refs.streamBuffer.current.length
      : getNextWordRevealIndex(refs.streamBuffer.current, refs.displayedTextLength.current);

    applyDisplayedStreamingState(refs, setters, nextDisplayedLength);
    if (mode === "step" && refs.displayedTextLength.current < refs.streamBuffer.current.length) {
      scheduleStreamingTextReveal(refs, setters);
    }
  });
  refs.raf.current = ranSynchronously ? null : rafId;
}

function flushStreamingText(refs: StreamRefs, setters: StreamSetters): void {
  cancelPendingStreamFlush(refs);
  applyDisplayedStreamingState(refs, setters, refs.streamBuffer.current.length);
}

function scheduleStreamingTextReveal(
  refs: StreamRefs,
  setters: StreamSetters,
): void {
  if (refs.raf.current !== null || refs.flushTimeout.current !== null) return;
  if (refs.displayedTextLength.current >= refs.streamBuffer.current.length) return;

  refs.flushTimeout.current = setTimeout(() => {
    refs.flushTimeout.current = null;
    queueStreamingTextReveal(refs, setters);
  }, getWordRevealDelayMs(refs));
}

export function resetStreamBuffers(refs: StreamRefs, setters: StreamSetters): void {
  cancelPendingStreamFlush(refs);
  setters.setStreamingText("");
  refs.streamBuffer.current = "";
  refs.displayedTextLength.current = 0;
  refs.lastTextFlushAt.current = 0;
  setters.setThinkingText("");
  refs.thinkingBuffer.current = "";
  refs.thinkingStart.current = null;
  setters.setThinkingDurationMs(null);
  refs.toolCalls.current = [];
  setters.setActiveToolCalls([]);
  refs.timeline.current = [];
  setters.setTimeline([]);
  setters.setProgressText("");
  setters.setIsWriting(false);
  refs.snapshottedToolCallIds.current = new Set();
}

let _tlId = 0;
function nextTimelineId(): string {
  return `tl-${++_tlId}`;
}

/**
 * Retroactively resolve a tool call in already-saved events.
 * handleAssistantTurnBoundary snapshots tool calls before results arrive,
 * so we propagate the resolution back into those saved events.
 */
function resolveToolCallInEvents(
  setters: StreamSetters,
  toolCallId: string,
  result: string,
  isError: boolean,
): void {
  setters.setEvents((prev) => {
    let changed = false;
    const next = prev.map((evt) => {
      if (!evt.toolCalls) return evt;
      const idx = evt.toolCalls.findIndex((tc) => tc.id === toolCallId && tc.pending);
      if (idx === -1) return evt;
      changed = true;
      return {
        ...evt,
        toolCalls: evt.toolCalls.map((tc, i) =>
          i === idx
            ? { ...tc, result, isError, pending: false, started: false }
            : tc,
        ),
      };
    });
    return changed ? next : prev;
  });
}

/**
 * Fail all pending tool calls in already-saved events.
 */
function resolvePendingToolCallsInEvents(
  setters: StreamSetters,
  resolution: PendingToolResolution,
): void {
  setters.setEvents((prev) => {
    let changed = false;
    const next = prev.map((evt) => {
      if (!evt.toolCalls?.some((tc) => tc.pending)) return evt;
      changed = true;
      return {
        ...evt,
        toolCalls: evt.toolCalls.map((tc) =>
          tc.pending
            ? {
                ...tc,
                pending: false,
                started: false,
                isError: resolution.isError,
                ...(resolution.result !== undefined ? { result: resolution.result } : {}),
              }
            : tc,
        ),
      };
    });
    return changed ? next : prev;
  });
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
  // Reuse the most recent thinking segment whenever possible. A new segment
  // should only appear when a non-thinking item (tool call, text, etc.) was
  // pushed in between — otherwise we emit a second `thinking` timeline item
  // that renders the same global buffer and surfaces as a duplicate block.
  const lastIdx = tl.length - 1;
  const last = lastIdx >= 0 ? tl[lastIdx] : null;
  if (last && last.kind === "thinking") {
    last.text = (last.text ?? "") + text;
  } else {
    tl.push({ kind: "thinking", id: nextTimelineId(), text });
  }

  if (refs.thinkingRaf.current === null) {
    let ranSynchronously = false;
    const rafId = requestAnimationFrame(() => {
      ranSynchronously = true;
      refs.thinkingRaf.current = null;
      setters.setThinkingText(refs.thinkingBuffer.current);
      syncDisplayedTimeline(refs, setters);
    });
    refs.thinkingRaf.current = ranSynchronously ? null : rafId;
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

  // Strict linear ordering: text is only ever appended to the tail of the
  // timeline. If the last item is a text item we extend it; otherwise we
  // push a fresh text item. Text is never folded back above an intervening
  // tool or thinking block — the visible order (text, tool, text, tool…)
  // must match arrival order exactly.
  const tl = refs.timeline.current;
  const last = tl.length > 0 ? tl[tl.length - 1] : null;

  refs.streamBuffer.current += text;

  if (last && last.kind === "text") {
    last.content += text;
  } else {
    tl.push({ kind: "text", content: text, id: nextTimelineId() });
  }

  scheduleStreamingTextReveal(refs, setters);
}

export function handleToolCallStarted(
  refs: StreamRefs,
  setters: StreamSetters,
  info: ToolCallStartedInfo,
): void {
  // Idempotent on `info.id`: duplicate deliveries (e.g. from concurrent
  // subscribers on the same streamKey that slip past the shared-registry
  // single-flight, or history replay overlapping with a live stream)
  // must not produce a second tool card or timeline row. Match the
  // existing find-by-id guard in `handleToolCall`/`handleToolCallSnapshot`.
  const existingIdx = refs.toolCalls.current.findIndex((tc) => tc.id === info.id);
  if (existingIdx !== -1) {
    const existing = refs.toolCalls.current[existingIdx];
    if (!existing.started) {
      refs.toolCalls.current = refs.toolCalls.current.map((tc, i) =>
        i === existingIdx ? { ...tc, started: true, pending: tc.pending ?? true } : tc,
      );
      setters.setActiveToolCalls([...refs.toolCalls.current]);
    }
    return;
  }

  const isSpecTool = info.name === "create_spec" || info.name === "update_spec";

  // For write_file/edit_file we intentionally leave `initialInput` empty so
  // the FileBlock renders its compact "Writing code..." header instead of an
  // empty code surface. Partial snapshots will populate `path`/`content`/
  // `old_text`/`new_text` live as they arrive from the stream.
  let initialInput: Record<string, unknown> = {};
  if (isSpecTool) {
    const draftPreview = refs.streamBuffer.current.trim();
    if (draftPreview) initialInput = { draft_preview: draftPreview };
  }

  const entry: ToolCallEntry = {
    id: info.id,
    name: info.name,
    input: initialInput,
    pending: true,
    started: true,
  };
  refs.toolCalls.current = [...refs.toolCalls.current, entry];
  setters.setActiveToolCalls([...refs.toolCalls.current]);

  const alreadyInTimeline = refs.timeline.current.some(
    (item) => item.kind === "tool" && item.toolCallId === info.id,
  );
  if (!alreadyInTimeline) {
    refs.timeline.current.push({ kind: "tool", toolCallId: info.id, id: nextTimelineId() });
    syncDisplayedTimeline(refs, setters);
  }
}

export function handleToolCallSnapshot(
  refs: StreamRefs,
  setters: StreamSetters,
  info: ToolCallSnapshotInfo,
): void {
  const input = normalizeToolInput(info.input);
  const idx = refs.toolCalls.current.findIndex((tc) => tc.id === info.id);
  if (idx === -1) {
    refs.toolCalls.current = [
      ...refs.toolCalls.current,
      {
        id: info.id,
        name: info.name,
        input,
        pending: true,
        started: true,
      },
    ];
    const alreadyInTimeline = refs.timeline.current.some(
      (item) => item.kind === "tool" && item.toolCallId === info.id,
    );
    if (!alreadyInTimeline) {
      refs.timeline.current.push({ kind: "tool", toolCallId: info.id, id: nextTimelineId() });
      syncDisplayedTimeline(refs, setters);
    }
    setters.setActiveToolCalls([...refs.toolCalls.current]);
    return;
  }

  refs.toolCalls.current = refs.toolCalls.current.map((tc) =>
    tc.id === info.id
      ? {
        ...tc,
        name: info.name,
        input: { ...normalizeToolInput(tc.input), ...input },
        // A fresh snapshot means bytes are flowing again, so any
        // previous streaming-retry banner should disappear. We
        // intentionally keep `retryAttempt`/`retryMax`/`retryReason`
        // so a later `ToolCallFailed` can still report "retried N/max".
        retrying: false,
      }
      : tc,
  );
  setters.setActiveToolCalls([...refs.toolCalls.current]);
}

/**
 * Handler for {@link EventType.ToolCallRetrying}. Finds the live
 * tool-call entry by `tool_use_id` and flips it into "retrying" state
 * so {@link FileBlock} (and any future renderer) can render
 * "Writing retrying (n/max)…" while the harness's next attempt is
 * still pending bytes.
 *
 * If we haven't seen a `ToolCallStarted` for this id yet (out-of-order
 * arrival across the IPC + SSE pipeline), we synthesize a pending
 * placeholder so the badge isn't lost. Subsequent snapshot/result
 * events will fold their data into the same entry via the normal
 * find-by-id path.
 */
export function handleToolCallRetrying(
  refs: StreamRefs,
  setters: StreamSetters,
  info: ToolCallRetryingInfo,
): void {
  const idx = refs.toolCalls.current.findIndex((tc) => tc.id === info.id);
  if (idx === -1) {
    refs.toolCalls.current = [
      ...refs.toolCalls.current,
      {
        id: info.id,
        name: info.name,
        input: {},
        pending: true,
        started: true,
        retrying: true,
        retryAttempt: info.attempt,
        retryMax: info.max_attempts,
        retryReason: info.reason,
      },
    ];
    const alreadyInTimeline = refs.timeline.current.some(
      (item) => item.kind === "tool" && item.toolCallId === info.id,
    );
    if (!alreadyInTimeline) {
      refs.timeline.current.push({ kind: "tool", toolCallId: info.id, id: nextTimelineId() });
      syncDisplayedTimeline(refs, setters);
    }
    setters.setActiveToolCalls([...refs.toolCalls.current]);
    return;
  }

  refs.toolCalls.current = refs.toolCalls.current.map((tc, i) =>
    i === idx
      ? {
        ...tc,
        retrying: true,
        retryAttempt: info.attempt,
        retryMax: info.max_attempts,
        retryReason: info.reason,
      }
      : tc,
  );
  setters.setActiveToolCalls([...refs.toolCalls.current]);
}

/**
 * Handler for {@link EventType.ToolCallFailed}. Marks the tool call
 * terminally failed (both `retrying` cleared and `retryExhausted`
 * latched), synthesizes an error `result` from the classified reason,
 * and propagates the state into any already-saved events the same
 * way {@link resolveToolCallInEvents} does for normal tool results.
 */
export function handleToolCallFailed(
  refs: StreamRefs,
  setters: StreamSetters,
  info: ToolCallFailedInfo,
): void {
  const reasonText = info.reason?.trim() || "upstream tool call failed";
  const result = `Tool call failed after retries: ${reasonText}`;
  const idx = refs.toolCalls.current.findIndex((tc) => tc.id === info.id);
  if (idx !== -1) {
    refs.toolCalls.current = refs.toolCalls.current.map((tc, i) =>
      i === idx
        ? {
          ...tc,
          pending: false,
          started: false,
          isError: true,
          retrying: false,
          retryExhausted: true,
          retryReason: reasonText,
          result,
        }
        : tc,
    );
    setters.setActiveToolCalls([...refs.toolCalls.current]);
  }

  setters.setEvents((prev) => {
    let changed = false;
    const next = prev.map((evt) => {
      if (!evt.toolCalls) return evt;
      const savedIdx = evt.toolCalls.findIndex((tc) => tc.id === info.id);
      if (savedIdx === -1) return evt;
      changed = true;
      return {
        ...evt,
        toolCalls: evt.toolCalls.map((tc, i) =>
          i === savedIdx
            ? {
                ...tc,
                pending: false,
                started: false,
                isError: true,
                retrying: false,
                retryExhausted: true,
                retryReason: reasonText,
                result,
              }
            : tc,
        ),
      };
    });
    return changed ? next : prev;
  });
}

export function handleToolCall(
  refs: StreamRefs,
  setters: StreamSetters,
  info: ToolCallInfo,
): void {
  const input = normalizeToolInput(info.input);
  const existingIdx = refs.toolCalls.current.findIndex((tc) => tc.id === info.id);
  if (existingIdx !== -1) {
    const existing = refs.toolCalls.current[existingIdx];
    const existingMarkdown = typeof existing.input.markdown_contents === "string"
      ? (existing.input.markdown_contents as string)
      : "";
    const incomingMarkdown = typeof input.markdown_contents === "string"
      ? (input.markdown_contents as string)
      : undefined;
    let mergedMarkdown = existingMarkdown;
    if (incomingMarkdown !== undefined) {
      if (!existingMarkdown || incomingMarkdown.startsWith(existingMarkdown) || incomingMarkdown.length >= existingMarkdown.length) {
        mergedMarkdown = incomingMarkdown;
      } else {
        mergedMarkdown = existingMarkdown + incomingMarkdown;
      }
    }
    const mergedInput: Record<string, unknown> = { ...normalizeToolInput(existing.input), ...input };
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
      input,
      pending: true,
    };
    refs.toolCalls.current = [...refs.toolCalls.current, entry];

    const alreadyInTimeline = refs.timeline.current.some(
      (item) => item.kind === "tool" && item.toolCallId === info.id,
    );
    if (!alreadyInTimeline) {
      refs.timeline.current.push({ kind: "tool", toolCallId: info.id, id: nextTimelineId() });
      syncDisplayedTimeline(refs, setters);
    }
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
    for (let i = refs.toolCalls.current.length - 1; i >= 0; i--) {
      const tc = refs.toolCalls.current[i];
      if (tc.pending && tc.name === info.name) {
        targetIndex = i;
        break;
      }
    }
  }

  let resolvedId: string | undefined;
  if (targetIndex !== -1) {
    resolvedId = refs.toolCalls.current[targetIndex].id;
    refs.toolCalls.current = refs.toolCalls.current.map((tc, idx) =>
      idx === targetIndex
        ? {
            ...tc,
            result: info.result,
            isError: info.is_error,
            pending: false,
            started: false,
            retrying: false,
          }
        : tc,
    );
  }
  setters.setActiveToolCalls([...refs.toolCalls.current]);

  if (resolvedId) {
    resolveToolCallInEvents(setters, resolvedId, info.result, info.is_error);
  }
}

function isTextOrImage(b: ChatContentBlock): b is Extract<ChatContentBlock, { type: "text" } | { type: "image" }> {
  return b.type === "text" || b.type === "image";
}

function isAssistantBoundaryPlaceholder(message: DisplaySessionEvent): boolean {
  return message.role === "assistant" && message.id.startsWith("stream-");
}

export function handleEventSaved(
  refs: StreamRefs,
  setters: StreamSetters,
  msg: SessionEvent,
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
  const savedMessage: DisplaySessionEvent = {
    id: msg.event_id,
    role: "assistant",
    content: msg.content,
    contentBlocks: displayBlocks.length > 0 ? displayBlocks : undefined,
    toolCalls: finalToolCalls,
    artifactRefs: extractArtifactRefs(allBlocks),
    thinkingText: savedThinking,
    thinkingDurationMs: savedThinkingDuration,
    timeline: snapshotTimeline(refs),
  };

  setters.setEvents((prev) => {
    const lastMessage = prev[prev.length - 1];
    if (
      lastMessage &&
      isAssistantBoundaryPlaceholder(lastMessage) &&
      lastMessage.content === savedMessage.content
    ) {
      return [...prev.slice(0, -1), savedMessage];
    }

    return [...prev, savedMessage];
  });
  resetStreamBuffers(refs, setters);
}

/**
 * Lightweight handler for AssistantMessageEnd during a harness stream.
 * Saves the current text buffer as a message but does NOT abort the SSE
 * connection or clear tool calls — tool_result events and subsequent agent
 * loop iterations arrive AFTER assistant_message_end.
 *
 * Only includes tool calls not already snapshotted by a prior boundary
 * to avoid duplicating tool entries across multiple saved events.
 */
export function handleAssistantTurnBoundary(
  refs: StreamRefs,
  setters: StreamSetters,
): void {
  const hasBuffer = !!refs.streamBuffer.current;
  if (hasBuffer) {
    flushStreamingText(refs, setters);
    const { savedThinking, savedThinkingDuration } = snapshotThinking(refs);
    const bufferedContent = refs.streamBuffer.current;

    const newToolCalls = refs.toolCalls.current.filter(
      (tc) => !refs.snapshottedToolCallIds.current.has(tc.id),
    );
    const newToolCallIds = new Set(newToolCalls.map((tc) => tc.id));

    const newTimeline = refs.timeline.current.filter(
      (item) => item.kind !== "tool" || newToolCallIds.has(item.toolCallId),
    );

    for (const tc of newToolCalls) {
      refs.snapshottedToolCallIds.current.add(tc.id);
    }

    setters.setEvents((prev) => [
      ...prev,
      {
        id: `stream-${Date.now()}`,
        role: "assistant",
        content: bufferedContent,
        toolCalls: newToolCalls.length > 0 ? [...newToolCalls] : undefined,
        thinkingText: savedThinking,
        thinkingDurationMs: savedThinkingDuration,
        timeline: newTimeline.length > 0 ? [...newTimeline] : undefined,
      },
    ]);
    setters.setStreamingText("");
    refs.streamBuffer.current = "";
    refs.displayedTextLength.current = 0;
    refs.lastTextFlushAt.current = 0;
    setters.setThinkingText("");
    refs.thinkingBuffer.current = "";
    refs.thinkingStart.current = null;
    setters.setThinkingDurationMs(null);
    setters.setIsWriting(false);
  }
  refs.timeline.current = [];
  setters.setTimeline([]);
}

function resolvePendingToolCalls(
  refs: StreamRefs,
  setters: StreamSetters,
  resolution: PendingToolResolution,
): void {
  const hasPending = refs.toolCalls.current.some((tc) => tc.pending);
  if (!hasPending) {
    resolvePendingToolCallsInEvents(setters, resolution);
    return;
  }
  refs.toolCalls.current = refs.toolCalls.current.map((tc) =>
    tc.pending
      ? {
          ...tc,
          pending: false,
          started: false,
          isError: resolution.isError,
          ...(resolution.result !== undefined ? { result: resolution.result } : {}),
        }
      : tc,
  );
  resolvePendingToolCallsInEvents(setters, resolution);
}

/**
 * Resolve every currently-pending tool call as errored WITHOUT flushing
 * the stream buffer or appending an assistant event. Intended for
 * non-terminal mid-turn failures — e.g. a `task_retrying` event arrives
 * because the harness's LLM stream died with a transient 5xx and the
 * dev loop is restarting the automaton. The old pending `write_file` /
 * `edit_file` cards would otherwise sit showing "Writing code…" forever
 * while fresh tool calls pile up below them on the retry attempt, which
 * is the UX the user flagged as "it just keeps saying writing code".
 *
 * The caller owns whether the stream is still live — we deliberately
 * avoid touching `setIsStreaming`, `setIsWriting`, or `streamBuffer`
 * so a follow-up turn can resume cleanly. Also updates the saved
 * events list via {@link resolvePendingToolCallsInEvents} so cards
 * that were already snapshotted by a prior `AssistantMessageEnd` get
 * the same treatment and don't stay stuck in the pending state.
 */
export function resolveAbandonedPendingToolCalls(
  refs: StreamRefs,
  setters: StreamSetters,
  reason: string,
): void {
  const trimmed = reason.trim();
  const result = trimmed
    ? `Interrupted by upstream error: ${trimmed}`
    : "Interrupted by upstream error before result was received";
  const resolution: PendingToolResolution = { isError: true, result };
  const hasPending = refs.toolCalls.current.some((tc) => tc.pending);
  if (hasPending) {
    refs.toolCalls.current = refs.toolCalls.current.map((tc) =>
      tc.pending
        ? {
            ...tc,
            pending: false,
            started: false,
            isError: true,
            result,
          }
        : tc,
    );
    // Mirror the live ref update into the active view so the
    // currently-visible card flips immediately instead of waiting for
    // the next snapshot boundary.
    setters.setActiveToolCalls([...refs.toolCalls.current]);
  }
  resolvePendingToolCallsInEvents(setters, resolution);
}

function getPendingToolResolution(
  reason: FinalizeStreamReason,
  message?: string,
): PendingToolResolution {
  switch (reason) {
    case "completed":
      return {
        isError: false,
        result: message ?? "Completed before an explicit tool result was received",
      };
    case "failed":
      return {
        isError: true,
        result: message ?? "Run failed before an explicit tool result was received",
      };
    case "disconnected":
    default:
      return {
        isError: true,
        result: message ?? "Connection lost before result was received",
      };
  }
}

export function handleStreamError(
  refs: StreamRefs,
  setters: StreamSetters,
  error: unknown,
): void {
  const rawMessage = getStreamErrorMessage(error);
  const { message, displayVariant } = normalizeStreamError(error);

  console.error("Chat stream error:", rawMessage);
  if (displayVariant === "insufficientCreditsError") {
    dispatchInsufficientCredits();
  }
  flushStreamingText(refs, setters);
  resolvePendingToolCalls(refs, setters, {
    isError: true,
    result: `Stream error: ${message}`,
  });
  setters.setActiveToolCalls([...refs.toolCalls.current]);

  const { savedThinking, savedThinkingDuration } = snapshotThinking(refs);
  const prefix = refs.streamBuffer.current
    ? refs.streamBuffer.current + "\n\n"
    : "";
  setters.setEvents((prev) => [
    ...prev,
    {
      id: `error-${Date.now()}`,
      role: "assistant",
      content: displayVariant
        ? prefix + message
        : prefix + `*Error: ${message}*`,
      displayVariant,
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
  options?: FinalizeStreamOptions,
): void {
  if (refs.streamBuffer.current) {
    flushStreamingText(refs, setters);
  } else {
    cancelPendingStreamFlush(refs);
  }
  resolvePendingToolCalls(
    refs,
    setters,
    getPendingToolResolution(options?.reason ?? "disconnected", options?.message),
  );
  setters.setActiveToolCalls([...refs.toolCalls.current]);

  const hasBuffer = !!refs.streamBuffer.current;
  const unsnapshottedToolCalls = refs.toolCalls.current.filter(
    (tc) => !refs.snapshottedToolCallIds.current.has(tc.id),
  );
  const hasUnsnapshottedTools = unsnapshottedToolCalls.length > 0;
  // Terminal outcomes (task/run completed or failed) never receive a follow-up
  // save, so we must consolidate the current turn now. For mid-stream closures
  // without a terminal reason, keep the existing behavior and let the caller
  // save the turn on its AssistantMessageEnd path.
  const isTerminalReason =
    options?.reason === "completed" || options?.reason === "failed";
  const shouldPersistTurn =
    (hasBuffer || hasUnsnapshottedTools) && (!closureIsStreaming || isTerminalReason);

  if (shouldPersistTurn) {
    const { savedThinking, savedThinkingDuration } = snapshotThinking(refs);
    const bufferedContent = refs.streamBuffer.current;
    const newToolCallIds = new Set(unsnapshottedToolCalls.map((tc) => tc.id));
    const bufferedTimeline = refs.timeline.current.filter(
      (item) => item.kind !== "tool" || newToolCallIds.has(item.toolCallId),
    );
    for (const tc of unsnapshottedToolCalls) {
      refs.snapshottedToolCallIds.current.add(tc.id);
    }
    setters.setEvents((prev) => [
      ...prev,
      {
        id: `stream-${Date.now()}`,
        role: "assistant",
        content: bufferedContent,
        toolCalls: hasUnsnapshottedTools ? [...unsnapshottedToolCalls] : undefined,
        thinkingText: savedThinking,
        thinkingDurationMs: savedThinkingDuration,
        timeline: bufferedTimeline.length > 0 ? [...bufferedTimeline] : undefined,
      },
    ]);
    setters.setStreamingText("");
    refs.streamBuffer.current = "";
    refs.displayedTextLength.current = 0;
    refs.lastTextFlushAt.current = 0;
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
  // When hasBuffer is true but closureIsStreaming prevents saving (non-terminal),
  // preserve thinking so it is included when the message is saved on the
  // subsequent call (e.g. onDone after AssistantMessageEnd).

  setters.setProgressText("");
  setters.setIsStreaming(false);
  setters.setIsWriting(false);
  abortRef.current?.abort();
  abortRef.current = null;
}
