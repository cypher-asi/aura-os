import { create } from "zustand";
import type { SetStateAction } from "react";
import type {
  DisplaySessionEvent,
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
  events: DisplaySessionEvent[];
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
  events: [],
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
// Entries that hold a finalized turn (events non-empty, not actively
// streaming) are protected from eviction for this window so that
// in-session collapse/expand and navigation away/back keep the rich
// post-completion view without re-hitting the persisted turn cache.
const STREAM_STORE_FINALIZED_PROTECT_MS = 30 * 60 * 1000;

/* ------------------------------------------------------------------ */
/*  Shared event-bus subscriptions, refcounted per streamKey.          */
/*                                                                     */
/*  Multiple components frequently mount the same useTaskStream /      */
/*  useProcessNodeStream for a given key (e.g. a task rendered both    */
/*  as a TaskPreview in the chat row and as ActiveTaskStream in the    */
/*  sidekick Run tab). Without this registry each mount independently  */
/*  subscribes to the shared event-store EventTypes, and every         */
/*  callback writes into the same streamKey-scoped refs — so a single  */
/*  WS event fans out to N duplicate tool cards / timeline rows. The   */
/*  refcounted registrar guarantees one subscription set per key no    */
/*  matter how many consumers mount.                                    */
/* ------------------------------------------------------------------ */

interface SharedSubscriptionEntry {
  refCount: number;
  disposers: Array<() => void>;
}

const sharedSubscriptions = new Map<string, SharedSubscriptionEntry>();

/**
 * Acquire the shared set of event-bus subscriptions for `key`. If this
 * is the first acquire the `register` callback runs and its returned
 * disposers are stored. Subsequent acquires just bump the refcount. The
 * returned release function is idempotent; when the last consumer
 * releases, the stored disposers run and the entry is dropped.
 */
export function acquireSharedStreamSubscriptions(
  key: string,
  register: () => Array<() => void>,
): () => void {
  let entry = sharedSubscriptions.get(key);
  if (!entry) {
    entry = { refCount: 0, disposers: register() };
    sharedSubscriptions.set(key, entry);
  }
  entry.refCount += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = sharedSubscriptions.get(key);
    if (!current) return;
    current.refCount -= 1;
    if (current.refCount <= 0) {
      for (const dispose of current.disposers) {
        try {
          dispose();
        } catch {
          // Disposer failures should not block further cleanup.
        }
      }
      sharedSubscriptions.delete(key);
    }
  };
}

/** Test-only: returns the current refcount for a shared subscription. */
export function peekSharedSubscriptionRefCount(key: string): number {
  return sharedSubscriptions.get(key)?.refCount ?? 0;
}

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
    flushTimeout: { current: null },
    displayedTextLength: { current: 0 },
    lastTextFlushAt: { current: 0 },
    thinkingRaf: { current: null },
    timeline: { current: [] },
    snapshottedToolCallIds: { current: new Set() },
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

function isFinalizedProtected(
  key: string,
  entries: Record<string, StreamEntryState>,
  meta: StreamMeta,
  now: number,
): boolean {
  const entry = entries[key];
  if (!entry) return false;
  if (entry.isStreaming) return true;
  if (entry.events.length === 0) return false;
  return now - meta.lastAccessedAt <= STREAM_STORE_FINALIZED_PROTECT_MS;
}

export function pruneStreamStore(preserveKey?: string): void {
  const now = Date.now();
  const entries = useStreamStore.getState().entries;
  const toDelete: string[] = [];

  for (const [key, meta] of streamMetaMap) {
    if (key === preserveKey) continue;
    if (entries[key]?.isStreaming) continue;
    if (isFinalizedProtected(key, entries, meta, now)) continue;
    if (now - meta.lastAccessedAt > STREAM_STORE_IDLE_TTL_MS) {
      toDelete.push(key);
    }
  }

  if (streamMetaMap.size - toDelete.length > STREAM_STORE_MAX_ENTRIES) {
    const removable = [...streamMetaMap.entries()]
      .filter(([key, meta]) =>
        key !== preserveKey &&
        !entries[key]?.isStreaming &&
        !toDelete.includes(key) &&
        !isFinalizedProtected(key, entries, meta, now),
      )
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

/**
 * Seed a stream entry's `events` array from a persisted cache when
 * the live entry is empty. Used by `useTaskOutputView` so reopening a
 * finalized task after the in-memory entry has been pruned still
 * renders the full structured turn history without a server round
 * trip. No-ops when the entry already has events or is streaming so
 * we never clobber live data.
 */
export function seedStreamEventsFromCache(
  key: string,
  events: DisplaySessionEvent[],
): void {
  if (!key || !events || events.length === 0) return;
  ensureEntry(key);
  useStreamStore.setState((s) => {
    const existing = s.entries[key];
    if (!existing) return s;
    if (existing.isStreaming) return s;
    if (existing.events.length > 0) return s;
    return {
      entries: {
        ...s.entries,
        [key]: { ...existing, events },
      },
    };
  });
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
    setEvents(v) {
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { events: resolve(v, cur?.events ?? []) });
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
