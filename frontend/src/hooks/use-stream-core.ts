import { useRef, useState, useCallback, useLayoutEffect, useEffect, useMemo } from "react";
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
/*  Module-level stream store                                          */
/*                                                                     */
/*  Keeps stream state alive across React mount/unmount cycles so      */
/*  navigating away from a chat and returning restores the live        */
/*  stream instead of aborting it.                                     */
/* ------------------------------------------------------------------ */

interface StreamEntry {
  key: string;
  refs: StreamRefs;
  abort: AbortController | null;
  isStreaming: boolean;
  messages: DisplayMessage[];
  streamingText: string;
  thinkingText: string;
  thinkingDurationMs: number | null;
  activeToolCalls: ToolCallEntry[];
  progressText: string;
  /** Current React setters – null when the component is unmounted. */
  reactSetters: StreamSetters | null;
}

const streamStore = new Map<string, StreamEntry>();

function storeKey(deps: unknown[]): string {
  return deps.filter(Boolean).join(":");
}

function makeEntry(key: string): StreamEntry {
  return {
    key,
    refs: {
      streamBuffer: { current: "" },
      thinkingBuffer: { current: "" },
      thinkingStart: { current: null },
      toolCalls: { current: [] },
      needsSeparator: { current: false },
      raf: { current: null },
      thinkingRaf: { current: null },
    },
    abort: null,
    isStreaming: false,
    messages: [],
    streamingText: "",
    thinkingText: "",
    thinkingDurationMs: null,
    activeToolCalls: [],
    progressText: "",
    reactSetters: null,
  };
}

function resolve<T>(action: SetStateAction<T>, prev: T): T {
  return typeof action === "function"
    ? (action as (p: T) => T)(prev)
    : action;
}

/**
 * Create proxy setters that always update the persistent entry snapshot
 * and forward to React when the component is mounted.
 */
function createProxySetters(entry: StreamEntry): StreamSetters {
  return {
    setStreamingText(v) {
      entry.streamingText = resolve(v, entry.streamingText);
      entry.reactSetters?.setStreamingText(entry.streamingText);
    },
    setThinkingText(v) {
      entry.thinkingText = resolve(v, entry.thinkingText);
      entry.reactSetters?.setThinkingText(entry.thinkingText);
    },
    setThinkingDurationMs(v) {
      entry.thinkingDurationMs = resolve(v, entry.thinkingDurationMs);
      entry.reactSetters?.setThinkingDurationMs(entry.thinkingDurationMs);
    },
    setActiveToolCalls(v) {
      entry.activeToolCalls = resolve(v, entry.activeToolCalls);
      entry.reactSetters?.setActiveToolCalls(entry.activeToolCalls);
    },
    setMessages(v) {
      entry.messages = resolve(v, entry.messages);
      entry.reactSetters?.setMessages(entry.messages);
    },
    setIsStreaming(v) {
      entry.isStreaming = resolve(v, entry.isStreaming);
      entry.reactSetters?.setIsStreaming(entry.isStreaming);
    },
    setProgressText(v) {
      entry.progressText = resolve(v, entry.progressText);
      entry.reactSetters?.setProgressText(entry.progressText);
    },
  };
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
  const key = storeKey(resetDeps);

  // Find or create the persistent entry for this chat.
  const entryRef = useRef<{ key: string; entry: StreamEntry } | null>(null);
  if (!entryRef.current || entryRef.current.key !== key) {
    let entry = streamStore.get(key);
    if (!entry) {
      entry = makeEntry(key);
      streamStore.set(key, entry);
    }
    entryRef.current = { key, entry };
  }
  const entry = entryRef.current.entry;

  // Stable proxy setters (recreated only when the entry changes).
  const settersRef = useRef<StreamSetters>(null!);
  if (!settersRef.current || entryRef.current.key !== key) {
    settersRef.current = createProxySetters(entry);
  }
  const setters = settersRef.current;

  // React state – initialised from the persistent entry so the first
  // render already contains any data accumulated while unmounted.
  const [messages, setMessages] = useState<DisplayMessage[]>(() => entry.messages);
  const [isStreaming, setIsStreaming] = useState(() => entry.isStreaming);
  const [streamingText, setStreamingText] = useState(() => entry.streamingText);
  const [thinkingText, setThinkingText] = useState(() => entry.thinkingText);
  const [thinkingDurationMs, setThinkingDurationMs] = useState<number | null>(() => entry.thinkingDurationMs);
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCallEntry[]>(() => entry.activeToolCalls);
  const [progressText, setProgressText] = useState(() => entry.progressText);

  const isStreamingRef = useRef(entry.isStreaming);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);

  const thinkingDurationMsRef = useRef<number | null>(entry.thinkingDurationMs);
  useEffect(() => { thinkingDurationMsRef.current = thinkingDurationMs; }, [thinkingDurationMs]);

  // Proxy abort ref – reads/writes go directly to the entry so the
  // background stream and the hook always share the same controller.
  const abortRef = useMemo<MutableRefObject<AbortController | null>>(() => {
    const holder: { current: AbortController | null } = { current: null };
    Object.defineProperty(holder, "current", {
      get() { return entryRef.current!.entry.abort; },
      set(v: AbortController | null) { entryRef.current!.entry.abort = v; },
      enumerable: true,
      configurable: true,
    });
    return holder;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Connect React setters to the entry on every render so the proxy
  // always forwards to the live component instance.
  entry.reactSetters = {
    setStreamingText, setThinkingText, setThinkingDurationMs,
    setActiveToolCalls, setMessages, setIsStreaming, setProgressText,
  };

  // Sync state from the entry on mount / deps change and disconnect
  // React on cleanup.  The stream is NOT aborted – it keeps running
  // in the background with callbacks writing to the persistent entry.
  useLayoutEffect(() => {
    const e = entryRef.current!.entry;
    setMessages(e.messages);
    setIsStreaming(e.isStreaming);
    setStreamingText(e.streamingText);
    setThinkingText(e.thinkingText);
    setThinkingDurationMs(e.thinkingDurationMs);
    setActiveToolCalls(e.activeToolCalls);
    setProgressText(e.progressText);
    isStreamingRef.current = e.isStreaming;
    thinkingDurationMsRef.current = e.thinkingDurationMs;

    return () => {
      e.reactSetters = null;
      if (e.refs.raf.current !== null) {
        cancelAnimationFrame(e.refs.raf.current);
        e.refs.raf.current = null;
      }
      if (e.refs.thinkingRaf.current !== null) {
        cancelAnimationFrame(e.refs.thinkingRaf.current);
        e.refs.thinkingRaf.current = null;
      }
      if (!e.isStreaming) {
        streamStore.delete(e.key);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, resetDeps);

  // resetMessages guards against overwriting an active stream's
  // accumulated messages with a stale API response.
  const resetMessages = useCallback((msgs: DisplayMessage[]) => {
    const e = entryRef.current!.entry;
    if (e.isStreaming) return;
    e.messages = msgs;
    setMessages(msgs);
  }, []);

  const baseStopStreaming = useCallback(() => {
    const e = entryRef.current!.entry;
    const s = settersRef.current;
    e.abort?.abort();
    if (e.refs.streamBuffer.current) {
      const snap = snapshotThinking(e.refs);
      s.setMessages((prev) => [
        ...prev,
        {
          id: `stopped-${Date.now()}`,
          role: "assistant" as const,
          content: e.refs.streamBuffer.current,
          toolCalls: snapshotToolCalls(e.refs),
          thinkingText: snap.savedThinking,
          thinkingDurationMs: snap.savedThinkingDuration,
        },
      ]);
    }
    resetStreamBuffers(e.refs, s);
    s.setIsStreaming(false);
    e.abort = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    messages, isStreaming, streamingText, thinkingText, thinkingDurationMs,
    activeToolCalls, progressText,
    refs: entry.refs, setters, abortRef, isStreamingRef, thinkingDurationMsRef, rafRef: entry.refs.raf,
    setMessages: setters.setMessages, setIsStreaming: setters.setIsStreaming, setProgressText: setters.setProgressText,
    resetMessages, baseStopStreaming,
  };
}
