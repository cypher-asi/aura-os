import { useRef, useCallback, useLayoutEffect, useMemo } from "react";
import type { MutableRefObject, SetStateAction } from "react";
import type {
  DisplayMessage,
  StreamRefs as StreamRefsType,
  StreamSetters,
} from "../types/stream";
import {
  storeKey,
  ensureEntry,
  createSetters,
  pruneStreamStore,
  getIsStreaming,
  streamMetaMap,
} from "./stream/store";
import type { StreamMeta } from "./stream/store";
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
  handleToolCallSnapshot,
  handleToolCall,
  handleToolResult,
  handleMessageSaved,
  handleStreamError,
  finalizeStream,
} from "./stream/handlers";

export { getIsStreaming, getThinkingDurationMs } from "./stream/store";

/* ------------------------------------------------------------------ */
/*  Core hook — lifecycle only, no React state                         */
/* ------------------------------------------------------------------ */

export interface StreamCoreResult {
  key: string;
  refs: StreamRefsType;
  setters: StreamSetters;
  abortRef: MutableRefObject<AbortController | null>;
  setMessages: (action: SetStateAction<DisplayMessage[]>) => void;
  setIsStreaming: (action: SetStateAction<boolean>) => void;
  setProgressText: (action: SetStateAction<string>) => void;
  resetMessages: (msgs: DisplayMessage[], options?: { allowWhileStreaming?: boolean }) => void;
  baseStopStreaming: () => void;
}

export function useStreamCore(resetDeps: unknown[]): StreamCoreResult {
  const key = storeKey(resetDeps);

  const prevKeyRef = useRef(key);
  const keyChanged = prevKeyRef.current !== key;
  prevKeyRef.current = key;

  const metaRef = useRef<{ key: string; meta: StreamMeta } | null>(null);
  if (!metaRef.current || keyChanged) {
    const meta = ensureEntry(key);
    pruneStreamStore(key);
    metaRef.current = { key, meta };
  }
  const meta = metaRef.current.meta;

  const settersRef = useRef<StreamSetters | null>(null);
  if (!settersRef.current || keyChanged) {
    settersRef.current = createSetters(key);
  }
  const setters = settersRef.current;

  const abortRef = useMemo<MutableRefObject<AbortController | null>>(() => ({
    get current() { return streamMetaMap.get(key)?.abort ?? null; },
    set current(v: AbortController | null) {
      const m = streamMetaMap.get(key);
      if (m) m.abort = v;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [key]);

  useLayoutEffect(() => {
    return () => {
      if (meta.refs.raf.current !== null) {
        cancelAnimationFrame(meta.refs.raf.current);
        meta.refs.raf.current = null;
      }
      if (meta.refs.thinkingRaf.current !== null) {
        cancelAnimationFrame(meta.refs.thinkingRaf.current);
        meta.refs.thinkingRaf.current = null;
      }
      meta.lastAccessedAt = Date.now();
      pruneStreamStore(key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, resetDeps);

  const resetMessages = useCallback((msgs: DisplayMessage[], options?: { allowWhileStreaming?: boolean }) => {
    if (getIsStreaming(key) && !options?.allowWhileStreaming) return;
    const m = streamMetaMap.get(key);
    if (m) m.lastAccessedAt = Date.now();
    setters.setMessages(msgs);
  }, [key, setters]);

  const baseStopStreaming = useCallback(() => {
    const m = streamMetaMap.get(key);
    if (!m) return;
    m.abort?.abort();
    if (m.refs.streamBuffer.current) {
      const snap = snapshotThinking(m.refs);
      setters.setMessages((prev) => [
        ...prev,
        {
          id: `stopped-${Date.now()}`,
          role: "assistant" as const,
          content: m.refs.streamBuffer.current,
          toolCalls: snapshotToolCalls(m.refs),
          thinkingText: snap.savedThinking,
          thinkingDurationMs: snap.savedThinkingDuration,
          timeline: snapshotTimeline(m.refs),
        },
      ]);
    }
    resetStreamBuffers(m.refs, setters);
    setters.setIsStreaming(false);
    m.abort = null;
  }, [key, setters]);

  return {
    key,
    refs: meta.refs,
    setters,
    abortRef,
    setMessages: setters.setMessages,
    setIsStreaming: setters.setIsStreaming,
    setProgressText: setters.setProgressText,
    resetMessages,
    baseStopStreaming,
  };
}
