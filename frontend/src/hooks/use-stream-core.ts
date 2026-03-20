import { useRef, useState, useCallback, useEffect } from "react";
import type { MutableRefObject, Dispatch, SetStateAction } from "react";
import { isInsufficientCreditsError, dispatchInsufficientCredits } from "../api/client";
import type { ToolCallStartedInfo, ToolCallInfo, ToolResultInfo } from "../api/streams";
import type { Message } from "../types";
import { extractToolCalls, extractArtifactRefs } from "../utils/chat-history";

/* ------------------------------------------------------------------ */
/*  Shared display types                                               */
/* ------------------------------------------------------------------ */

export interface DisplayContentBlock {
  type: "text";
  text: string;
}

export interface DisplayImageBlock {
  type: "image";
  media_type: string;
  data: string;
}

export type DisplayContentBlockUnion = DisplayContentBlock | DisplayImageBlock;

export interface ArtifactRef {
  kind: "task" | "spec";
  id: string;
  title: string;
}

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: ToolCallEntry[];
  artifactRefs?: ArtifactRef[];
  contentBlocks?: DisplayContentBlockUnion[];
  thinkingText?: string;
  thinkingDurationMs?: number | null;
}

export interface ToolCallEntry {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  pending: boolean;
  started?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Ref / setter interfaces                                            */
/* ------------------------------------------------------------------ */

export interface StreamRefs {
  streamBuffer: MutableRefObject<string>;
  thinkingBuffer: MutableRefObject<string>;
  thinkingStart: MutableRefObject<number | null>;
  toolCalls: MutableRefObject<ToolCallEntry[]>;
  needsSeparator: MutableRefObject<boolean>;
  raf: MutableRefObject<number | null>;
  thinkingRaf: MutableRefObject<number | null>;
}

export interface StreamSetters {
  setStreamingText: Dispatch<SetStateAction<string>>;
  setThinkingText: Dispatch<SetStateAction<string>>;
  setThinkingDurationMs: Dispatch<SetStateAction<number | null>>;
  setActiveToolCalls: Dispatch<SetStateAction<ToolCallEntry[]>>;
  setMessages: Dispatch<SetStateAction<DisplayMessage[]>>;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setProgressText: Dispatch<SetStateAction<string>>;
}

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

export function resetStreamBuffers(refs: StreamRefs, setters: StreamSetters) {
  setters.setStreamingText("");
  refs.streamBuffer.current = "";
  setters.setThinkingText("");
  refs.thinkingBuffer.current = "";
  refs.thinkingStart.current = null;
  setters.setThinkingDurationMs(null);
  refs.toolCalls.current = [];
  setters.setActiveToolCalls([]);
}

/* ------------------------------------------------------------------ */
/*  Stream event handlers                                              */
/* ------------------------------------------------------------------ */

export function handleThinkingDelta(
  refs: StreamRefs,
  setters: StreamSetters,
  text: string,
) {
  setters.setProgressText("");
  if (refs.thinkingStart.current === null) {
    refs.thinkingStart.current = Date.now();
  }
  refs.thinkingBuffer.current += text;
  if (refs.thinkingRaf.current === null) {
    refs.thinkingRaf.current = requestAnimationFrame(() => {
      refs.thinkingRaf.current = null;
      setters.setThinkingText(refs.thinkingBuffer.current);
    });
  }
}

export function handleTextDelta(
  refs: StreamRefs,
  setters: StreamSetters,
  closureThinkingDurationMs: number | null,
  text: string,
) {
  setters.setProgressText("");
  if (refs.thinkingStart.current !== null && closureThinkingDurationMs === null) {
    setters.setThinkingDurationMs(Date.now() - refs.thinkingStart.current);
  }
  if (refs.needsSeparator.current && refs.streamBuffer.current.length > 0) {
    refs.streamBuffer.current += "\n\n";
    refs.needsSeparator.current = false;
  }
  refs.streamBuffer.current += text;
  if (refs.raf.current === null) {
    refs.raf.current = requestAnimationFrame(() => {
      refs.raf.current = null;
      setters.setStreamingText(refs.streamBuffer.current);
    });
  }
}

export function handleToolCallStarted(
  refs: StreamRefs,
  setters: StreamSetters,
  info: ToolCallStartedInfo,
) {
  setters.setProgressText("");
  const entry: ToolCallEntry = {
    id: info.id,
    name: info.name,
    input: {},
    pending: true,
    started: true,
  };
  refs.toolCalls.current = [...refs.toolCalls.current, entry];
  setters.setActiveToolCalls([...refs.toolCalls.current]);
}

export function handleToolCall(
  refs: StreamRefs,
  setters: StreamSetters,
  info: ToolCallInfo,
) {
  setters.setProgressText("");
  const existingIdx = refs.toolCalls.current.findIndex(
    (tc) => tc.id === info.id && tc.started,
  );
  if (existingIdx !== -1) {
    refs.toolCalls.current = refs.toolCalls.current.map((tc) =>
      tc.id === info.id && tc.started
        ? { ...tc, input: info.input, started: false }
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
  }
  setters.setActiveToolCalls([...refs.toolCalls.current]);
}

export function handleToolResult(
  refs: StreamRefs,
  setters: StreamSetters,
  info: ToolResultInfo,
) {
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
) {
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
    },
  ]);
  resetStreamBuffers(refs, setters);
}

export function handleStreamError(
  refs: StreamRefs,
  setters: StreamSetters,
  message: string,
) {
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
    },
  ]);
  resetStreamBuffers(refs, setters);
}

export function finalizeStream(
  refs: StreamRefs,
  setters: StreamSetters,
  abortRef: MutableRefObject<AbortController | null>,
  closureIsStreaming: boolean,
) {
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
      },
    ]);
    setters.setStreamingText("");
    refs.streamBuffer.current = "";
    refs.toolCalls.current = [];
    setters.setActiveToolCalls([]);
  }
  setters.setThinkingText("");
  refs.thinkingBuffer.current = "";
  refs.thinkingStart.current = null;
  setters.setThinkingDurationMs(null);
  setters.setIsStreaming(false);
  abortRef.current = null;
}

/* ------------------------------------------------------------------ */
/*  Core hook                                                          */
/* ------------------------------------------------------------------ */

export function useStreamCore(resetDeps: unknown[]) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [thinkingText, setThinkingText] = useState("");
  const [thinkingDurationMs, setThinkingDurationMs] = useState<number | null>(null);
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCallEntry[]>([]);
  const [progressText, setProgressText] = useState("");

  const isStreamingRef = useRef(false);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);

  const thinkingDurationMsRef = useRef<number | null>(null);
  useEffect(() => { thinkingDurationMsRef.current = thinkingDurationMs; }, [thinkingDurationMs]);

  const abortRef = useRef<AbortController | null>(null);
  const streamBufferRef = useRef("");
  const rafRef = useRef<number | null>(null);
  const thinkingBufferRef = useRef("");
  const thinkingRafRef = useRef<number | null>(null);
  const thinkingStartRef = useRef<number | null>(null);
  const toolCallsRef = useRef<ToolCallEntry[]>([]);
  const needsSeparatorRef = useRef(false);

  const refs: StreamRefs = {
    streamBuffer: streamBufferRef,
    thinkingBuffer: thinkingBufferRef,
    thinkingStart: thinkingStartRef,
    toolCalls: toolCallsRef,
    needsSeparator: needsSeparatorRef,
    raf: rafRef,
    thinkingRaf: thinkingRafRef,
  };

  const setters: StreamSetters = {
    setStreamingText,
    setThinkingText,
    setThinkingDurationMs,
    setActiveToolCalls,
    setMessages,
    setIsStreaming,
    setProgressText,
  };

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (thinkingRafRef.current !== null) cancelAnimationFrame(thinkingRafRef.current);
      rafRef.current = null;
      thinkingRafRef.current = null;
      streamBufferRef.current = "";
      thinkingBufferRef.current = "";
      thinkingStartRef.current = null;
      toolCallsRef.current = [];
      needsSeparatorRef.current = false;
      setStreamingText("");
      setThinkingText("");
      setThinkingDurationMs(null);
      setActiveToolCalls([]);
      setIsStreaming(false);
      setProgressText("");
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, resetDeps);

  const resetMessages = useCallback((msgs: DisplayMessage[]) => {
    setMessages(msgs);
  }, []);

  const baseStopStreaming = useCallback(() => {
    abortRef.current?.abort();
    if (streamBufferRef.current) {
      const snap = snapshotThinking(refs);
      setMessages((prev) => [
        ...prev,
        {
          id: `stopped-${Date.now()}`,
          role: "assistant" as const,
          content: streamBufferRef.current,
          toolCalls: snapshotToolCalls(refs),
          thinkingText: snap.savedThinking,
          thinkingDurationMs: snap.savedThinkingDuration,
        },
      ]);
    }
    resetStreamBuffers(refs, setters);
    setIsStreaming(false);
    abortRef.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    messages, isStreaming, streamingText, thinkingText, thinkingDurationMs,
    activeToolCalls, progressText,
    refs, setters, abortRef, isStreamingRef, thinkingDurationMsRef, rafRef,
    setMessages, setIsStreaming, setProgressText,
    resetMessages, baseStopStreaming,
  };
}
