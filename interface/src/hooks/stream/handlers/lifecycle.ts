import type { MutableRefObject } from "react";
import {
  isInsufficientCreditsError,
  isAgentBusyError,
  isHarnessCapacityExhaustedError,
  dispatchInsufficientCredits,
} from "../../../api/client";
import { SSEIdleTimeoutError } from "../../../shared/api/sse";
import {
  recordStreamCloseReason,
  type StreamCloseClassification,
  type StreamCloseContext,
} from "../../../shared/observability/stream-breadcrumbs";
import { extractSupportId } from "../../../shared/observability/support-id";
import type { SessionEvent, ChatContentBlock } from "../../../shared/types";
import { extractToolCalls, extractArtifactRefs } from "../../../utils/chat-history";
import type {
  DisplayContentBlockUnion,
  DisplaySessionEvent,
  StreamRefs,
  StreamSetters,
} from "../../../shared/types/stream";
import {
  cancelPendingStreamFlush,
  closeCurrentThinkingSegment,
  flushStreamingText,
  resetStreamBuffers,
  snapshotThinking,
  snapshotTimeline,
  snapshotToolCalls,
  type PendingToolResolution,
} from "./shared";
import { resolvePendingToolCalls } from "./tool";

export type FinalizeStreamReason = "completed" | "failed" | "disconnected";

/**
 * Map the `displayVariant` returned by `normalizeStreamError` (or
 * the absence of it) onto the
 * {@link StreamCloseClassification} bucket the
 * `aura:stream-close` breadcrumb consumer expects. `failed` is the
 * default for "we got an error but it didn't fall into a known
 * bucket" — matches the existing `*Error: ${displayMessage}*`
 * fallback.
 */
function classifyStreamErrorVariant(
  displayVariant?:
    | "insufficientCreditsError"
    | "agentBusyError"
    | "harnessCapacityExhaustedError"
    | "streamDropped",
): StreamCloseClassification {
  switch (displayVariant) {
    case "insufficientCreditsError":
      return "insufficientCredits";
    case "agentBusyError":
      return "agentBusy";
    case "harnessCapacityExhaustedError":
      return "harnessCapacity";
    case "streamDropped":
      return "streamDropped";
    default:
      return "failed";
  }
}

/**
 * Map a {@link FinalizeStreamReason} (the optional `reason` field
 * passed to `finalizeStream`) onto a breadcrumb classification. The
 * mapping is identity except that the `disconnected` reason — i.e.
 * `finalizeStream` was called without an explicit reason or with
 * `reason: "disconnected"` — emits a `disconnected` breadcrumb.
 */
function classifyFinalizeReason(
  reason: FinalizeStreamReason | undefined,
): StreamCloseClassification {
  switch (reason ?? "disconnected") {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "disconnected":
    default:
      return "disconnected";
  }
}

interface FinalizeStreamOptions {
  reason?: FinalizeStreamReason;
  message?: string;
  /**
   * Snapshot of the live `progressText` slot (the "Submitting plan…"
   * / "Cooking…" cooking-indicator label) at the moment the caller
   * decided to finalize. Forwarded by `task-stream-bootstrap` so a
   * `task_failed` arriving before any `text_delta` / tool result has
   * landed still leaves the Run pane row with some signal of what
   * phase the loop was in. Ignored for `completed` / `disconnected`
   * reasons because the live progressText is otherwise reset to "".
   */
  progressText?: string;
  /**
   * Phase 5: optional context the chat hooks can thread through so
   * the persisted breadcrumb carries the stream key / agent id /
   * session id alongside the close reason. Lifecycle handlers are
   * agnostic of these ids; the use-site (the chat hook closing
   * over the captured partition) supplies them when available.
   */
  breadcrumbContext?: StreamCloseContext;
}

/**
 * Fallback `errorMessage` for synthetic failed-turn events when the
 * caller has nothing better. Pinned to a constant so the
 * task-stream-bootstrap can defer to `finalizeStream` for the canonical
 * wording without duplicating the string at the call site.
 */
export const FINALIZE_FAILED_DEFAULT_MESSAGE =
  "task failed without a reason from the harness";

function getStreamErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object"
    && error !== null
    && "message" in error
    && typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return String(error);
}

function getStreamErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object"
    && error !== null
    && "code" in error
    && typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return undefined;
}

/**
 * Match provider transport failures that arrive as a generic `llm_error`.
 * These are different from model/auth/validation failures: the request was
 * accepted, but the upstream HTTP/SSE connection disappeared before the
 * assistant turn completed, so replaying the saved user turn is safe.
 */
function isTransientProviderTransportError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("connection closed before message completed") ||
    normalized.includes("provider stream interrupted before completion") ||
    normalized.includes("error sending request for url") ||
    normalized.includes("connection reset by peer") ||
    normalized.includes("stream terminated unexpectedly")
  );
}

/**
 * Detects errors that the chat hook should treat as a transient
 * "stream dropped" event rather than a hard failure. Includes:
 *
 * - `SSEIdleTimeoutError` (client-side 90s read-watchdog),
 * - `stream_lagged` (server-side broadcast backpressure),
 * - `stream_truncated` (server-side broadcast closed before terminal),
 * - `turn_timeout` / `stream_stalled` (server-side turn watchdogs),
 * - `harness_ws_closed` / `harness_ws_read_error` (Phase 2: the
 *   upstream harness WebSocket dropped mid-turn; the next send
 *   transparently rehydrates state from session storage),
 * - `harness_protocol_mismatch` (untyped harness frame; same
 *   recovery path applies because the WS reader bails after
 *   emitting this error).
 */
export function isStreamDroppedError(error: unknown, message?: string): boolean {
  if (error instanceof SSEIdleTimeoutError) return true;
  if (error instanceof Error && error.name === "SSEIdleTimeoutError") return true;
  const code = getStreamErrorCode(error);
  if (
    code === "STREAM_LAGGED" ||
    code === "stream_lagged" ||
    code === "STREAM_TRUNCATED" ||
    code === "stream_truncated"
  ) {
    return true;
  }
  if (
    code === "TURN_TIMEOUT" ||
    code === "turn_timeout" ||
    code === "STREAM_STALLED" ||
    code === "stream_stalled"
  ) {
    return true;
  }
  if (
    code === "harness_ws_closed" ||
    code === "harness_ws_read_error" ||
    code === "harness_protocol_mismatch"
  ) {
    return true;
  }
  if (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "stream_lagged"
  ) {
    return true;
  }
  const text = message ?? getStreamErrorMessage(error);
  if (/^SSE idle timeout/i.test(text)) return true;
  if (/^Stream lagged/i.test(text)) return true;
  if (isTransientProviderTransportError(text)) return true;
  return false;
}

export type StreamErrorDisplayVariant =
  | "insufficientCreditsError"
  | "agentBusyError"
  | "harnessCapacityExhaustedError"
  | "streamDropped";

export function normalizeStreamError(error: unknown): {
  message: string;
  displayVariant?: StreamErrorDisplayVariant;
} {
  if (isInsufficientCreditsError(error)) {
    return {
      message: "You have no credits remaining. Buy more credits to continue.",
      displayVariant: "insufficientCreditsError",
    };
  }

  const capacityExhausted = isHarnessCapacityExhaustedError(error);
  if (capacityExhausted) {
    const retrySeconds =
      typeof capacityExhausted.retry_after_seconds === "number" &&
      capacityExhausted.retry_after_seconds > 0
        ? capacityExhausted.retry_after_seconds
        : 5;
    return {
      message: `Server is busy — try again in ${retrySeconds} second${
        retrySeconds === 1 ? "" : "s"
      }.`,
      displayVariant: "harnessCapacityExhaustedError",
    };
  }

  const agentBusy = isAgentBusyError(error);
  if (agentBusy) {
    const message =
      agentBusy.reason === "queue_full"
        ? "Too many turns are queued for this agent — wait a moment and try again."
        : "This agent is currently running an automation task. Stop the automation to chat.";
    return {
      message,
      displayVariant: "agentBusyError",
    };
  }

  const rawMessage = getStreamErrorMessage(error);
  if (isStreamDroppedError(error, rawMessage)) {
    return {
      message:
        "The connection to the agent dropped. Your turn is being recovered from history — refresh if it does not reappear shortly.",
      displayVariant: "streamDropped",
    };
  }

  if (rawMessage.includes("agent not found") || rawMessage.includes("agent instance not found")) {
    return {
      message: "Agent not found. Make sure the agent is assigned to a project.",
    };
  }

  return {
    message: rawMessage,
  };
}

function isTextOrImage(b: ChatContentBlock): b is Extract<ChatContentBlock, { type: "text" } | { type: "image" }> {
  return b.type === "text" || b.type === "image";
}

function isAssistantBoundaryPlaceholder(message: DisplaySessionEvent): boolean {
  return message.role === "assistant" && message.id.startsWith("stream-");
}

function chooseFinalAssistantContent(
  savedMessage: DisplaySessionEvent,
  placeholder: DisplaySessionEvent,
): string {
  const savedContent = savedMessage.content;
  const placeholderContent = placeholder.content;
  if (
    placeholderContent.length > savedContent.length &&
    (savedContent.trim().length === 0 || placeholderContent.startsWith(savedContent))
  ) {
    return placeholderContent;
  }
  return savedContent;
}

function mergeSavedAssistantMessage(
  savedMessage: DisplaySessionEvent,
  placeholder: DisplaySessionEvent,
): DisplaySessionEvent {
  return {
    ...savedMessage,
    // Preserve the placeholder's stable React key across the
    // `stream-...` -> persisted `event_id` swap. `id` flips to the
    // server-assigned identifier (used for dedup against the persisted
    // history list); `clientId` keeps the same React identity so the
    // bubble does not unmount on save.
    clientId: placeholder.clientId ?? placeholder.id,
    content: chooseFinalAssistantContent(savedMessage, placeholder),
    toolCalls: savedMessage.toolCalls ?? placeholder.toolCalls,
    thinkingText: savedMessage.thinkingText ?? placeholder.thinkingText,
    thinkingDurationMs:
      savedMessage.thinkingDurationMs ?? placeholder.thinkingDurationMs,
    timeline: savedMessage.timeline ?? placeholder.timeline,
  };
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
        : { type: "image" as const, media_type: b.media_type, data: b.data, source_url: b.source_url },
    );

  const msgToolCalls = extractToolCalls(allBlocks);
  const finalToolCalls =
    msgToolCalls && msgToolCalls.length > 0
      ? msgToolCalls
      : snapshotToolCalls(refs);

  const savedThinking = msg.thinking || refs.thinkingBuffer.current || undefined;
  const savedThinkingDuration = msg.thinking_duration_ms
    ?? (refs.thinkingStart.current != null ? Date.now() - refs.thinkingStart.current : null);
  // Stamp the trailing thinking segment's `durationMs` before
  // `snapshotTimeline` freezes the array into the persisted event so
  // the final block carries its own time instead of inheriting the
  // turn-level total via the `ActivityTimeline` fallback.
  closeCurrentThinkingSegment(refs);
  const savedMessage: DisplaySessionEvent = {
    id: msg.event_id,
    // Default `clientId = id` for the no-placeholder branch. The
    // placeholder branch overrides this in `mergeSavedAssistantMessage`
    // to preserve the bubble's React identity across the
    // `stream-...` -> persisted `event_id` swap.
    clientId: msg.event_id,
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
    const lastIsPlaceholder =
      !!lastMessage && isAssistantBoundaryPlaceholder(lastMessage);

    // Re-delivery guard: a resumable replay (reopening a still-streaming
    // subagent, or a reconnect tail) can re-emit a turn we already
    // committed under the same `event_id`. Replace it in place instead of
    // appending a duplicate, dropping a trailing placeholder that the
    // re-streamed deltas just rebuilt for this same turn. No-op for the
    // normal single-commit path (the id isn't present yet), so live chat
    // behaviour is unchanged — and it lets the subagent attach skip the
    // destructive `setEvents([])` clear that used to blank the transcript.
    const existingIdx = prev.findIndex(
      (e) => e.id === savedMessage.id && !isAssistantBoundaryPlaceholder(e),
    );
    if (existingIdx !== -1) {
      const base = lastIsPlaceholder ? prev.slice(0, -1) : prev;
      const next = base.slice();
      if (existingIdx < next.length) {
        next[existingIdx] = mergeSavedAssistantMessage(savedMessage, next[existingIdx]);
      }
      return next;
    }

    if (lastIsPlaceholder) {
      return [...prev.slice(0, -1), mergeSavedAssistantMessage(savedMessage, lastMessage)];
    }

    return [...prev, savedMessage];
  });
  resetStreamBuffers(refs, setters);
}

export function handleAssistantTurnBoundary(
  refs: StreamRefs,
  setters: StreamSetters,
): void {
  const hasBuffer = !!refs.streamBuffer.current;
  const newToolCalls = refs.toolCalls.current.filter(
    (tc) => !refs.snapshottedToolCallIds.current.has(tc.id),
  );
  const hasNewToolCalls = newToolCalls.length > 0;

  if (hasBuffer || hasNewToolCalls) {
    if (hasBuffer) {
      flushStreamingText(refs, setters);
    }
    // Close the active thinking segment so its `durationMs` is
    // baked into the placeholder's `timeline` snapshot. Without this
    // the trailing pre-tool segment would render with the turn-level
    // duration as a fallback, defeating the per-segment fix.
    closeCurrentThinkingSegment(refs);
    const { savedThinking, savedThinkingDuration } = snapshotThinking(refs);
    const bufferedContent = refs.streamBuffer.current;

    const newToolCallIds = new Set(newToolCalls.map((tc) => tc.id));
    const newTimeline = refs.timeline.current.filter(
      (item) => item.kind !== "tool" || newToolCallIds.has(item.toolCallId),
    );

    for (const tc of newToolCalls) {
      refs.snapshottedToolCallIds.current.add(tc.id);
    }

    const placeholderId = `stream-${Date.now()}`;
    setters.setEvents((prev) => [
      ...prev,
      {
        id: placeholderId,
        // Stable React identity; preserved by `mergeSavedAssistantMessage`
        // when `MessageEnd` swaps `id` to the persisted `event_id`.
        clientId: placeholderId,
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
  breadcrumbContext?: StreamCloseContext,
): void {
  const rawMessage = getStreamErrorMessage(error);
  const rawCode = getStreamErrorCode(error);
  // Phase 5: peel the `(support_id=...)` suffix off the raw server
  // message before any user-facing copy is built so the bubble
  // text stays clean and the id surfaces as a copyable chip on
  // the synthesized event instead.
  const { supportId, cleanedMessage } = extractSupportId(rawMessage);
  const { message, displayVariant } = normalizeStreamError(error);
  // For the unbucketed default branch `normalizeStreamError`
  // returns the raw message verbatim; swap in the cleaned copy so
  // the support_id suffix doesn't leak into the rendered bubble.
  const messageForDisplay =
    !displayVariant && message === rawMessage ? cleanedMessage : message;
  const displayMessage = rawCode && !displayVariant ? `${messageForDisplay} (${rawCode})` : messageForDisplay;

  console.error("Chat stream error:", rawCode ? `${rawCode}: ${rawMessage}` : rawMessage);
  // Phase 5 client-side breadcrumb. Fires BEFORE `dispatchInsufficientCredits`
  // and the React state churn below so a future telemetry handler
  // wiring to `aura:stream-close` sees the close reason on the same
  // tick the consumer first surfaces it. The persisted ring entry
  // also carries the parsed `support_id` and the optional
  // breadcrumb context (stream key / agent / session) supplied by
  // the use-site.
  recordStreamCloseReason(
    {
      classified: classifyStreamErrorVariant(displayVariant),
      message: cleanedMessage,
      code: rawCode,
      support_id: supportId ?? undefined,
    },
    breadcrumbContext,
  );
  if (displayVariant === "insufficientCreditsError") {
    dispatchInsufficientCredits();
  }
  flushStreamingText(refs, setters);
  resolvePendingToolCalls(refs, setters, {
    isError: true,
    result: `Stream error: ${displayMessage}`,
  });
  setters.setActiveToolCalls([...refs.toolCalls.current]);

  const { savedThinking, savedThinkingDuration } = snapshotThinking(refs);
  const savedToolCalls = snapshotToolCalls(refs);
  const savedTimeline = snapshotTimeline(refs);
  // Bubble `content` carries ONLY the partial streaming buffer
  // (text the assistant produced before the turn errored). The
  // synthesized error string moves to `errorMessage` so
  // `MessageBubble` can render it inline in the Support ID +
  // Report Bug action row instead of stacking it above the row
  // as a duplicate of what's already in the chip.
  //
  // Captured into a const here (not read off the ref inside the
  // setEvents callback) because `resetStreamBuffers` below
  // clears `refs.streamBuffer.current` before the React batch
  // flushes -- the lazy read would always observe an empty
  // buffer.
  const bufferedPrefix = refs.streamBuffer.current ?? "";
  const errorId = `error-${Date.now()}`;
  setters.setEvents((prev) => [
    ...prev,
    {
      id: errorId,
      clientId: errorId,
      role: "assistant",
      content: bufferedPrefix,
      errorMessage: displayMessage,
      displayVariant,
      supportId: supportId ?? undefined,
      toolCalls: savedToolCalls,
      thinkingText: savedThinking,
      thinkingDurationMs: savedThinkingDuration,
      timeline: savedTimeline,
    },
  ]);
  resetStreamBuffers(refs, setters);
  setters.setProgressText("");
  setters.clearGeneration();
  setters.setIsStreaming(false);
  setters.setIsWriting(false);
}

export function finalizeStream(
  refs: StreamRefs,
  setters: StreamSetters,
  abortRef: MutableRefObject<AbortController | null>,
  closureIsStreaming: boolean,
  options?: FinalizeStreamOptions,
): void {
  // Phase 5 client-side breadcrumb. Mirrors `handleStreamError` so
  // every stream-close (clean finalize OR error) fires exactly one
  // `aura:stream-close` event. `message` defaults to the
  // classification name when no explicit message is passed so the
  // consumer always has *something* to render.
  recordStreamCloseReason(
    {
      classified: classifyFinalizeReason(options?.reason),
      message: options?.message ?? options?.reason ?? "completed",
    },
    options?.breadcrumbContext,
  );
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
  const isFailed = options?.reason === "failed";
  const isTerminalReason = options?.reason === "completed" || isFailed;
  // Failed terminals always persist a synthetic event row, even when
  // there's no buffered text and no fresh tool calls. Without this
  // forced emit, an early `task_failed` (API timeout, completion-gate
  // rejection, etc.) leaves `events.length === 0`, `snapshotTaskTurns`
  // bails on its own empty-events guard, and `CompletedTaskOutput`
  // collapses to the generic "Task failed without producing output."
  // empty state — losing both the failure reason and whatever progress
  // label the user was watching in the live cooking indicator.
  const shouldPersistTurn =
    isFailed ||
    ((hasBuffer || hasUnsnapshottedTools) && (!closureIsStreaming || isTerminalReason));

  if (shouldPersistTurn) {
    // Stamp the trailing thinking segment so the synthesized
    // finalize event preserves per-segment durations on terminal
    // close (completed / failed / disconnected).
    closeCurrentThinkingSegment(refs);
    const { savedThinking, savedThinkingDuration } = snapshotThinking(refs);
    const bufferedContent = refs.streamBuffer.current;
    const newToolCallIds = new Set(unsnapshottedToolCalls.map((tc) => tc.id));
    const bufferedTimeline = refs.timeline.current.filter(
      (item) => item.kind !== "tool" || newToolCallIds.has(item.toolCallId),
    );
    for (const tc of unsnapshottedToolCalls) {
      refs.snapshottedToolCallIds.current.add(tc.id);
    }
    const finalizeId = `stream-${Date.now()}`;
    // Failure-only fields. Synthesize a stable fallback when the
    // caller's `message` is empty so the persisted event always
    // carries actionable text (mirrors the server-side
    // `synthesize_failure_reason` behaviour for
    // `tasks.execution_notes`). The progress-label hint folds in
    // whatever cooking-indicator text was visible at the moment of
    // failure when the bubble would otherwise have empty content.
    const errorMessage = isFailed
      ? (options?.message?.trim() || FINALIZE_FAILED_DEFAULT_MESSAGE)
      : undefined;
    const progressHint =
      isFailed && options?.progressText?.trim()
        ? options.progressText.trim()
        : undefined;
    const eventContent =
      !bufferedContent && progressHint
        ? `_was: ${progressHint}_`
        : bufferedContent;
    setters.setEvents((prev) => [
      ...prev,
      {
        id: finalizeId,
        clientId: finalizeId,
        role: "assistant",
        content: eventContent,
        toolCalls: hasUnsnapshottedTools ? [...unsnapshottedToolCalls] : undefined,
        thinkingText: savedThinking,
        thinkingDurationMs: savedThinkingDuration,
        timeline: bufferedTimeline.length > 0 ? [...bufferedTimeline] : undefined,
        ...(errorMessage ? { errorMessage } : {}),
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

  setters.setProgressText("");
  setters.clearGeneration();
  setters.setIsStreaming(false);
  setters.setIsWriting(false);
  abortRef.current?.abort();
  abortRef.current = null;
}
