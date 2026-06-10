import { useRef, useCallback, useLayoutEffect, useMemo } from "react";
import type { MutableRefObject, SetStateAction } from "react";
import type {
  DisplaySessionEvent,
  StreamRefs as StreamRefsType,
  StreamSetters,
} from "../shared/types/stream";
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
  DisplaySessionEvent,
  ToolCallEntry,
  TimelineItem,
  StreamRefs,
  StreamSetters,
} from "../shared/types/stream";

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
  handleToolCallRetrying,
  handleToolCallFailed,
  handleEventSaved,
  handleAssistantTurnBoundary,
  handleStreamError,
  finalizeStream,
  isStreamDroppedError,
  normalizeStreamError,
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
  setEvents: (action: SetStateAction<DisplaySessionEvent[]>) => void;
  setIsStreaming: (action: SetStateAction<boolean>) => void;
  setProgressText: (action: SetStateAction<string>) => void;
  resetEvents: (msgs: DisplaySessionEvent[], options?: { allowWhileStreaming?: boolean }) => void;
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
      // Skip the RAF / flushTimeout cancel when this entry is still
      // actively streaming. Inside a kept-mounted `<AgentChatPanel />`
      // a `projectId`/`agentInstanceId` change re-runs `resetDeps`
      // and triggers this cleanup even though the underlying hook
      // instance is alive — treating that as a true unmount stranded
      // the originating partition's buffered text and cancelled the
      // in-flight handler's scheduled flushes (Symptom 2 of the
      // parallel-chats freeze). When the entry is still streaming the
      // captured-partition handler will continue to drive its own
      // RAF/flushTimeout schedule, so leaving them in place is correct;
      // a true unmount lands here later via `pruneStreamStore`'s
      // eviction path once the partition is genuinely idle.
      const stillActive = getIsStreaming(key);
      if (!stillActive) {
        if (meta.refs.flushTimeout.current !== null) {
          clearTimeout(meta.refs.flushTimeout.current);
          meta.refs.flushTimeout.current = null;
        }
        if (meta.refs.raf.current !== null) {
          cancelAnimationFrame(meta.refs.raf.current);
          meta.refs.raf.current = null;
        }
        if (meta.refs.thinkingRaf.current !== null) {
          cancelAnimationFrame(meta.refs.thinkingRaf.current);
          meta.refs.thinkingRaf.current = null;
        }
      }
      meta.lastAccessedAt = Date.now();
      pruneStreamStore(key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, resetDeps);

  const resetEvents = useCallback((msgs: DisplaySessionEvent[], options?: { allowWhileStreaming?: boolean }) => {
    if (getIsStreaming(key) && !options?.allowWhileStreaming) return;
    const m = streamMetaMap.get(key);
    if (m) m.lastAccessedAt = Date.now();
    setters.setEvents(msgs);
  }, [key, setters]);

  const baseStopStreaming = useCallback(() => {
    const m = streamMetaMap.get(key);
    if (!m) return;
    m.abort?.abort();
    if (m.refs.streamBuffer.current) {
      const snap = snapshotThinking(m.refs);
      setters.setEvents((prev) => [
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
    setEvents: setters.setEvents,
    setIsStreaming: setters.setIsStreaming,
    setProgressText: setters.setProgressText,
    resetEvents,
    baseStopStreaming,
  };
}
