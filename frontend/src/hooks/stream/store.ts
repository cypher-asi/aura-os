import { create } from "zustand";
import type { SetStateAction } from "react";
import type {
  DisplayMessage,
  ToolCallEntry,
  TimelineItem,
  StreamRefs,
  StreamSetters,
} from "../../types/stream";

/* ------------------------------------------------------------------ */
/*  Zustand stream store                                               */
/*                                                                     */
/*  Keeps reactive stream state in a Zustand store so components can   */
/*  subscribe to individual slices. Non-reactive metadata (refs,       */
/*  abort controllers) live in a module-level Map.                     */
/* ------------------------------------------------------------------ */

export interface StreamEntryState {
  isStreaming: boolean;
  messages: DisplayMessage[];
  streamingText: string;
  thinkingText: string;
  thinkingDurationMs: number | null;
  activeToolCalls: ToolCallEntry[];
  timeline: TimelineItem[];
  progressText: string;
}

export interface StreamMeta {
  key: string;
  refs: StreamRefs;
  abort: AbortController | null;
  lastAccessedAt: number;
}

interface StreamStore {
  entries: Record<string, StreamEntryState>;
}

const INITIAL_ENTRY: StreamEntryState = {
  isStreaming: false,
  messages: [],
  streamingText: "",
  thinkingText: "",
  thinkingDurationMs: null,
  activeToolCalls: [],
  timeline: [],
  progressText: "",
};

export const useStreamStore = create<StreamStore>()(() => ({
  entries: {},
}));

export const streamMetaMap = new Map<string, StreamMeta>();
const STREAM_STORE_MAX_ENTRIES = 40;
const STREAM_STORE_IDLE_TTL_MS = 5 * 60 * 1000;

export function storeKey(deps: unknown[]): string {
  return deps.filter(Boolean).join(":");
}

function makeRefs(): StreamRefs {
  return {
    streamBuffer: { current: "" },
    thinkingBuffer: { current: "" },
    thinkingStart: { current: null },
    toolCalls: { current: [] },
    needsSeparator: { current: false },
    raf: { current: null },
    thinkingRaf: { current: null },
    toolCallRaf: { current: null },
    toolInputBuffers: { current: new Map() },
    timeline: { current: [] },
  };
}

export function ensureEntry(key: string): StreamMeta {
  let meta = streamMetaMap.get(key);
  if (!meta) {
    meta = { key, refs: makeRefs(), abort: null, lastAccessedAt: Date.now() };
    streamMetaMap.set(key, meta);
    useStreamStore.setState((s) => ({
      entries: { ...s.entries, [key]: { ...INITIAL_ENTRY } },
    }));
  }
  meta.lastAccessedAt = Date.now();
  return meta;
}

function touchEntry(key: string): void {
  const meta = streamMetaMap.get(key);
  if (meta) meta.lastAccessedAt = Date.now();
}

export function pruneStreamStore(preserveKey?: string): void {
  const now = Date.now();
  const entries = useStreamStore.getState().entries;
  const toDelete: string[] = [];

  for (const [key, meta] of streamMetaMap) {
    if (key === preserveKey) continue;
    if (entries[key]?.isStreaming) continue;
    if (now - meta.lastAccessedAt > STREAM_STORE_IDLE_TTL_MS) {
      toDelete.push(key);
    }
  }

  if (streamMetaMap.size - toDelete.length > STREAM_STORE_MAX_ENTRIES) {
    const removable = [...streamMetaMap.entries()]
      .filter(([key]) => key !== preserveKey && !entries[key]?.isStreaming && !toDelete.includes(key))
      .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);
    for (const [key] of removable) {
      if (streamMetaMap.size - toDelete.length <= STREAM_STORE_MAX_ENTRIES) break;
      toDelete.push(key);
    }
  }

  if (toDelete.length === 0) return;

  for (const key of toDelete) streamMetaMap.delete(key);
  useStreamStore.setState((s) => {
    const next = { ...s.entries };
    for (const key of toDelete) delete next[key];
    return { entries: next };
  });
}

export function resolve<T>(action: SetStateAction<T>, prev: T): T {
  return typeof action === "function"
    ? (action as (p: T) => T)(prev)
    : action;
}

function updateStreamEntry(key: string, patch: Partial<StreamEntryState>): void {
  useStreamStore.setState((s) => {
    const existing = s.entries[key];
    if (!existing) return s;
    return { entries: { ...s.entries, [key]: { ...existing, ...patch } } };
  });
}

export function getStreamEntry(key: string): StreamEntryState | undefined {
  return useStreamStore.getState().entries[key];
}

export function getIsStreaming(key: string): boolean {
  return useStreamStore.getState().entries[key]?.isStreaming ?? false;
}

export function getThinkingDurationMs(key: string): number | null {
  return useStreamStore.getState().entries[key]?.thinkingDurationMs ?? null;
}

/**
 * Create setters that update the Zustand store.
 * Same StreamSetters interface so handlers work unchanged.
 */
export function createSetters(key: string): StreamSetters {
  return {
    setStreamingText(v) {
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { streamingText: resolve(v, cur?.streamingText ?? "") });
    },
    setThinkingText(v) {
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { thinkingText: resolve(v, cur?.thinkingText ?? "") });
    },
    setThinkingDurationMs(v) {
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { thinkingDurationMs: resolve(v, cur?.thinkingDurationMs ?? null) });
    },
    setActiveToolCalls(v) {
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { activeToolCalls: resolve(v, cur?.activeToolCalls ?? []) });
    },
    setMessages(v) {
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { messages: resolve(v, cur?.messages ?? []) });
    },
    setIsStreaming(v) {
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { isStreaming: resolve(v, cur?.isStreaming ?? false) });
    },
    setProgressText(v) {
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { progressText: resolve(v, cur?.progressText ?? "") });
    },
    setTimeline(v) {
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { timeline: resolve(v, cur?.timeline ?? []) });
    },
  };
}
