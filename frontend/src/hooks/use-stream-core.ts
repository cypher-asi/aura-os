import { useRef, useState, useCallback, useLayoutEffect, useEffect, useMemo } from "react";
import type { MutableRefObject } from "react";
import type {
  DisplayMessage,
  ToolCallEntry,
  TimelineItem,
  StreamSetters,
} from "../types/stream";
import {
  streamStore,
  storeKey,
  makeEntry,
  createProxySetters,
} from "./stream/store";
import type { StreamEntry } from "./stream/store";
import {
  snapshotThinking,
  snapshotToolCalls,
  snapshotTimeline,
  resetStreamBuffers,
} from "./stream/handlers";

export type {
  DisplayContentBlock,
  DisplayImageBlock,
  DisplayContentBlockUnion,
  ArtifactRef,
  DisplayMessage,
  ToolCallEntry,
  TimelineItem,
  StreamRefs,
  StreamSetters,
} from "../types/stream";

export {
  snapshotThinking,
  snapshotToolCalls,
  snapshotTimeline,
  resetStreamBuffers,
  handleThinkingDelta,
  handleTextDelta,
  handleToolCallStarted,
  handleToolCall,
  handleToolResult,
  handleMessageSaved,
  handleStreamError,
  finalizeStream,
} from "./stream/handlers";

/* ------------------------------------------------------------------ */
/*  Core hook                                                          */
/* ------------------------------------------------------------------ */

export function useStreamCore(resetDeps: unknown[]) {
  const key = storeKey(resetDeps);

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

  const settersRef = useRef<StreamSetters>(null!);
  if (!settersRef.current || entryRef.current.key !== key) {
    settersRef.current = createProxySetters(entry);
  }
  const setters = settersRef.current;

  const [messages, setMessages] = useState<DisplayMessage[]>(() => entry.messages);
  const [isStreaming, setIsStreaming] = useState(() => entry.isStreaming);
  const [streamingText, setStreamingText] = useState(() => entry.streamingText);
  const [thinkingText, setThinkingText] = useState(() => entry.thinkingText);
  const [thinkingDurationMs, setThinkingDurationMs] = useState<number | null>(() => entry.thinkingDurationMs);
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCallEntry[]>(() => entry.activeToolCalls);
  const [timeline, setTimeline] = useState<TimelineItem[]>(() => entry.timeline);
  const [progressText, setProgressText] = useState(() => entry.progressText);

  const isStreamingRef = useRef(entry.isStreaming);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);

  const thinkingDurationMsRef = useRef<number | null>(entry.thinkingDurationMs);
  useEffect(() => { thinkingDurationMsRef.current = thinkingDurationMs; }, [thinkingDurationMs]);

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

  entry.reactSetters = {
    setStreamingText, setThinkingText, setThinkingDurationMs,
    setActiveToolCalls, setMessages, setIsStreaming, setProgressText, setTimeline,
  };

  useLayoutEffect(() => {
    const e = entryRef.current!.entry;
    setMessages(e.messages);
    setIsStreaming(e.isStreaming);
    setStreamingText(e.streamingText);
    setThinkingText(e.thinkingText);
    setThinkingDurationMs(e.thinkingDurationMs);
    setActiveToolCalls(e.activeToolCalls);
    setTimeline(e.timeline);
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
          timeline: snapshotTimeline(e.refs),
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
    activeToolCalls, timeline, progressText,
    refs: entry.refs, setters, abortRef, isStreamingRef, thinkingDurationMsRef, rafRef: entry.refs.raf,
    setMessages: setters.setMessages, setIsStreaming: setters.setIsStreaming, setProgressText: setters.setProgressText,
    resetMessages, baseStopStreaming,
  };
}
