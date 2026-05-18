import { create } from "zustand";
import { type SetStateAction } from "react";
import type {
  DisplaySessionEvent,
  ToolCallEntry,
  TimelineItem,
  StreamRefs,
  StreamSetters,
  GenerationKind,
} from "../../shared/types/stream";
import { clearPartitionAutoRetry } from "./partition-state";

/* ------------------------------------------------------------------ */
/*  Zustand stream store                                               */
/*                                                                     */
/*  Keeps reactive stream state in a Zustand store so components can   */
/*  subscribe to individual slices. Non-reactive metadata (refs,       */
/*  abort controllers) live in a module-level Map.                     */
/* ------------------------------------------------------------------ */

export interface StreamEntryState {
  isStreaming: boolean;
  // True while streamed text is actively revealing word-by-word (i.e. the
  // displayed slice is still catching up to the buffered text). Drives the
  // cooking indicator: it shows whenever the turn is in flow but we are not
  // actively writing tokens to the screen.
  isWriting: boolean;
  events: DisplaySessionEvent[];
  streamingText: string;
  thinkingText: string;
  thinkingDurationMs: number | null;
  activeToolCalls: ToolCallEntry[];
  timeline: TimelineItem[];
  progressText: string;
  // Wall-clock ms of the most recent SSE-driven setter call (any of
  // text/thinking/tool/event/progress/timeline). `null` when no
  // wire event has been observed for the entry yet. Drives the
  // stuck-stream watchdog (`useStreamHealth`).
  lastEventAt: number | null;
  // Wall-clock ms when the watchdog first noticed `isStreaming` was
  // true while `lastEventAt` had aged past `STUCK_THRESHOLD_MS`.
  // Cleared whenever a fresh wire event lands. Set/cleared by the
  // watchdog itself via `setStuckSince`; entry setters only clear it
  // alongside bumping `lastEventAt`.
  stuckSince: number | null;
  // Generation-lifecycle metadata. Populated when the entry is
  // driving an image/3D/video stream so the cooking-indicator ETA
  // countdown (`useGenerationEta`) can read the start wall-clock,
  // model id, and latest reported percent. All three are cleared
  // together on terminal events (completion / error) and on stream
  // reset so the countdown disappears the moment the stream ends.
  generationStartedAt: number | null;
  generationModel: string | null;
  generationKind: GenerationKind | null;
  // Latest `percent` reported by an upstream `generation_progress`
  // SSE frame, when present. Used to refine the initial per-model
  // fallback estimate into `elapsed * (100 - percent) / percent`
  // once meaningful (>= 5) progress lands.
  generationPercent: number | null;
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
  isWriting: false,
  events: [],
  streamingText: "",
  thinkingText: "",
  thinkingDurationMs: null,
  activeToolCalls: [],
  timeline: [],
  progressText: "",
  lastEventAt: null,
  stuckSince: null,
  generationStartedAt: null,
  generationModel: null,
  generationKind: null,
  generationPercent: null,
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

  for (const key of toDelete) {
    streamMetaMap.delete(key);
    // Keep BOTH auto-retry maps (project-chat send-control + standalone-
    // agent replay) in lockstep with the stream meta so an evicted
    // partition can't leak its retry timer / cached send payload on
    // either surface past its last live handler. The shared helper
    // short-circuits when a map has no entry, so a project-chat-only
    // key clears only the send-control map and vice versa.
    clearPartitionAutoRetry(key);
  }
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
 * Last wall-clock ms at which an SSE-driven setter ran for `key`.
 * `null` when no wire event has landed yet (or the entry has been
 * pruned). Read by `useStreamHealth` and the chat send guards so a
 * stuck-stream "send anyway" decision can be made without a hook
 * subscription.
 */
export function getLastEventAt(key: string): number | null {
  return useStreamStore.getState().entries[key]?.lastEventAt ?? null;
}

/**
 * Bump the wire-event clock for `key`. Called from every setter that
 * maps to an SSE event (text / thinking / tool / progress /
 * timeline / events). Setting `lastEventAt` to "now" and clearing
 * `stuckSince` happens in a single `setState` so a watchdog tick
 * never observes a half-updated entry. UI lifecycle setters
 * (`setIsStreaming`, `setIsWriting`) deliberately do NOT call this:
 * the streaming-true flip on send is not a wire event, and clearing
 * it on completion shouldn't pretend a fresh event landed.
 *
 * Exported for handlers that observe a wire event without driving
 * any setter — currently the `generation_partial_image` SSE arm in
 * the chat-stream handlers, which would otherwise let the
 * `useStuckStreamAutoTimeout` watchdog auto-abort a long
 * partial-image render (e.g. `gpt-image-2`) that legitimately
 * exceeds 60s between `progress` frames.
 */
export function markStreamProgress(key: string): void {
  const now = Date.now();
  useStreamStore.setState((s) => {
    const existing = s.entries[key];
    if (!existing) return s;
    return {
      entries: {
        ...s.entries,
        [key]: { ...existing, lastEventAt: now, stuckSince: null },
      },
    };
  });
}

/**
 * Watchdog-side setter for `stuckSince`. Exposed so
 * `useStreamHealth` can stamp the moment it first observed a stale
 * entry without piggybacking on a wire-event setter.
 */
export function setStuckSince(key: string, value: number | null): void {
  useStreamStore.setState((s) => {
    const existing = s.entries[key];
    if (!existing) return s;
    if (existing.stuckSince === value) return s;
    return {
      entries: {
        ...s.entries,
        [key]: { ...existing, stuckSince: value },
      },
    };
  });
}

/**
 * Either a static stream key or a getter that resolves the current
 * key on every setter invocation. The getter form lets callers like
 * `useChatStream`'s `performSend` follow a mid-turn key migration
 * (fresh-canvas → real session id, or auto-fork to a new session id)
 * without rebinding every captured setter reference. Static-string
 * callers stay backwards compatible.
 */
export type StreamKeyResolver = string | (() => string);

function resolveKey(r: StreamKeyResolver): string {
  return typeof r === "function" ? r() : r;
}

/**
 * Create setters that update the Zustand store.
 * Same StreamSetters interface so handlers work unchanged.
 *
 * Pass a `() => string` getter when the underlying stream key may
 * migrate mid-turn (see `migrateStreamPartition`); the setters will
 * follow the latest key on every invocation. Static strings stay
 * supported for the common case.
 */
export function createSetters(keyOrResolver: StreamKeyResolver): StreamSetters {
  const getKey = typeof keyOrResolver === "function" ? keyOrResolver : () => keyOrResolver;
  return {
    setStreamingText(v) {
      const key = getKey();
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { streamingText: resolve(v, cur?.streamingText ?? "") });
      markStreamProgress(key);
    },
    setThinkingText(v) {
      const key = getKey();
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { thinkingText: resolve(v, cur?.thinkingText ?? "") });
      markStreamProgress(key);
    },
    setThinkingDurationMs(v) {
      const key = getKey();
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { thinkingDurationMs: resolve(v, cur?.thinkingDurationMs ?? null) });
      markStreamProgress(key);
    },
    setActiveToolCalls(v) {
      const key = getKey();
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { activeToolCalls: resolve(v, cur?.activeToolCalls ?? []) });
      markStreamProgress(key);
    },
    setEvents(v) {
      const key = getKey();
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { events: resolve(v, cur?.events ?? []) });
      markStreamProgress(key);
    },
    setIsStreaming(v) {
      const key = getKey();
      touchEntry(key);
      const cur = getStreamEntry(key);
      const wasStreaming = cur?.isStreaming ?? false;
      const next = resolve(v, wasStreaming);
      const patch: Partial<StreamEntryState> = { isStreaming: next };
      // false -> true edge: rebase the stuck-stream watchdog clock so a
      // follow-up send on a session whose prior turn ended >STUCK_THRESHOLD_MS
      // ago doesn't render the pill instantly off the stale lastEventAt.
      if (next && !wasStreaming) {
        patch.lastEventAt = Date.now();
        patch.stuckSince = null;
      }
      updateStreamEntry(key, patch);
    },
    setIsWriting(v) {
      const key = getKey();
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { isWriting: resolve(v, cur?.isWriting ?? false) });
    },
    setProgressText(v) {
      const key = getKey();
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { progressText: resolve(v, cur?.progressText ?? "") });
      markStreamProgress(key);
    },
    setTimeline(v) {
      const key = getKey();
      touchEntry(key);
      const cur = getStreamEntry(key);
      updateStreamEntry(key, { timeline: resolve(v, cur?.timeline ?? []) });
      markStreamProgress(key);
    },
    setGenerationState(v) {
      const key = getKey();
      touchEntry(key);
      updateStreamEntry(key, {
        generationStartedAt: v.startedAt,
        generationModel: v.model,
        generationKind: v.kind,
        // A fresh start always resets the percent so a previous turn's
        // trailing value can't seed the next countdown's adaptive
        // estimate.
        generationPercent: null,
      });
    },
    setGenerationPercent(v) {
      const key = getKey();
      touchEntry(key);
      updateStreamEntry(key, { generationPercent: v });
      // Wire activity — keep the stuck-stream watchdog clock fresh.
      markStreamProgress(key);
    },
    clearGeneration() {
      const key = getKey();
      touchEntry(key);
      updateStreamEntry(key, {
        generationStartedAt: null,
        generationModel: null,
        generationKind: null,
        generationPercent: null,
      });
    },
  };
}

void resolveKey;

/**
 * Re-key any in-flight streaming state from `oldKey` to `newKey`. Used
 * when the server flips a fresh-canvas placeholder session id to a real
 * one (`SessionReady`) or auto-forks mid-stream to a new session. If
 * `newKey` already has an entry, it is left intact and the `oldKey`
 * entry is dropped (the new key's entry is the authoritative one — the
 * fresh-canvas → real-id migration races with `useStreamCore`'s
 * `ensureEntry(newKey)` on re-render, but the in-flight data lives at
 * `oldKey` so this branch is rare).
 *
 * Migration covers:
 *   - the Zustand `useStreamStore.entries` slice (events, isStreaming,
 *     streamingText, etc.)
 *   - the module-level `streamMetaMap` (refs, abort controller,
 *     lastAccessedAt) so `ensureEntry(newKey)` after re-render finds
 *     the in-flight refs object reference rather than minting a new
 *     one
 *
 * Sibling helpers `migratePartitionAutoRetry`
 * (`./partition-state.ts`, covers both per-surface auto-retry maps)
 * and `migrateChatUiPartition` (`chat-ui-store.ts`) take care of
 * their own per-key maps; the `migrateChatPartition` orchestrator in
 * `./migration.ts` invokes all of them in lockstep at every
 * session-id flip site.
 */
export function migrateStreamPartition(oldKey: string, newKey: string): void {
  if (oldKey === newKey) return;

  // Move the streamMeta (refs object reference + abort controller). We
  // must not mint a fresh meta at `newKey` because the in-flight
  // handler captured `partitionRefs = ensureEntry(oldKey).refs` and
  // continues to mutate that exact object reference; minting a new
  // meta would orphan those mutations.
  const oldMeta = streamMetaMap.get(oldKey);
  if (oldMeta) {
    if (!streamMetaMap.has(newKey)) {
      const moved: StreamMeta = {
        key: newKey,
        refs: oldMeta.refs,
        abort: oldMeta.abort,
        lastAccessedAt: oldMeta.lastAccessedAt,
      };
      streamMetaMap.set(newKey, moved);
    }
    streamMetaMap.delete(oldKey);
  }

  useStreamStore.setState((s) => {
    const oldEntry = s.entries[oldKey];
    if (!oldEntry) return s;
    if (s.entries[newKey]) {
      const { [oldKey]: _drop, ...rest } = s.entries;
      void _drop;
      return { entries: rest };
    }
    const { [oldKey]: moved, ...rest } = s.entries;
    return { entries: { ...rest, [newKey]: moved } };
  });
}

/**
 * Placeholder session-id segment used in the streamKey deps array
 * for a freshly-opened canvas before the server emits `SessionReady`.
 * Must match the literal string `useStreamCore` produces via
 * `storeKey` so `migrateStreamPartition` can re-key from this
 * placeholder to the real session id when it lands.
 *
 * Hoisted to a constant so the project-chat surface
 * (`useChatStream`), the standalone-agent surface
 * (`useAgentChatStream`), and the `keyFor*Session` helpers below
 * cannot drift from each other on a typo.
 */
export const FRESH_SESSION_PLACEHOLDER = "fresh";

/**
 * Per-session storeKey for a project-chat session row, mirroring the
 * `useStreamCore([projectId, agentInstanceId, sessionId ?? FRESH_SESSION_PLACEHOLDER])`
 * deps shape used by `useChatStream`. Phase 4 frontend tests reuse this
 * to assert which lane a given streaming turn lives on.
 */
export function keyForProjectSession(
  projectId: string,
  agentInstanceId: string,
  sessionId: string | null | undefined,
): string {
  return storeKey([projectId, agentInstanceId, sessionId ?? FRESH_SESSION_PLACEHOLDER]);
}

/**
 * Per-session storeKey for the standalone-agent chat surface, mirroring
 * `useStreamCore([agentId, sessionId ?? FRESH_SESSION_PLACEHOLDER])` in
 * `useAgentChatStream`.
 */
export function keyForAgentSession(
  agentId: string,
  sessionId: string | null | undefined,
): string {
  return storeKey([agentId, sessionId ?? FRESH_SESSION_PLACEHOLDER]);
}

/**
 * Reactive selector that returns `true` whenever the supplied stream
 * key has an in-flight turn on the client. Zustand's selector-based
 * subscription compares the returned primitive on every store update,
 * so a row only re-renders when its own `isStreaming` flips — unrelated
 * keys updating elsewhere in `entries` don't propagate through this
 * subscriber. Cheap enough for the hundreds of rows the sidekick
 * `SessionsList` may render on a long-lived agent.
 */
export function useIsStreamingByKey(key: string | undefined): boolean {
  return useStreamStore((s) =>
    key ? (s.entries[key]?.isStreaming ?? false) : false,
  );
}
