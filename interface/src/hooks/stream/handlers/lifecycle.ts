import type { MutableRefObject } from "react";
import {
  isInsufficientCreditsError,
  isAgentBusyError,
  dispatchInsufficientCredits,
} from "../../../api/client";
import { SSEIdleTimeoutError } from "../../../shared/api/sse";
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
  flushStreamingText,
  resetStreamBuffers,
  snapshotThinking,
  snapshotTimeline,
  snapshotToolCalls,
  type PendingToolResolution,
} from "./shared";
import { resolvePendingToolCalls } from "./tool";

export type FinalizeStreamReason = "completed" | "failed" | "disconnected";

interface FinalizeStreamOptions {
  reason?: FinalizeStreamReason;
  message?: string;
}

function getStreamErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

function isStreamDroppedError(error: unknown, message: string): boolean {
  if (error instanceof SSEIdleTimeoutError) return true;
  if (error instanceof Error && error.name === "SSEIdleTimeoutError") return true;
  if (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "stream_lagged"
  ) {
    return true;
  }
  if (/^SSE idle timeout/i.test(message)) return true;
  if (/^Stream lagged/i.test(message)) return true;
  return false;
}

function normalizeStreamError(error: unknown): {
  message: string;
  displayVariant?: "insufficientCreditsError" | "agentBusyError" | "streamDropped";
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

  const rawMessage = getStreamErrorMessage(error);
  if (isStreamDroppedError(error, rawMessage)) {
    return {
      message:
        "The chat stream went quiet unexpectedly. Your assistant turn is being recovered from history — refresh if it does not reappear shortly.",
      displayVariant: "streamDropped",
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
    const { savedThinking, savedThinkingDuration } = snapshotThinking(refs);
    const bufferedContent = refs.streamBuffer.current;

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
  const savedToolCalls = snapshotToolCalls(refs);
  const savedTimeline = snapshotTimeline(refs);
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
      toolCalls: savedToolCalls,
      thinkingText: savedThinking,
      thinkingDurationMs: savedThinkingDuration,
      timeline: savedTimeline,
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

  setters.setProgressText("");
  setters.setIsStreaming(false);
  setters.setIsWriting(false);
  abortRef.current?.abort();
  abortRef.current = null;
}
