import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { queryClient } from "../shared/lib/query-client";
import {
  BROWSER_DB_STORES,
  browserDbDelete,
  browserDbGet,
  browserDbSet,
} from "../shared/lib/browser-db";
import {
  CHAT_HISTORY_STALE_TIME_MS,
  chatHistoryQueryKeys,
  chatHistoryQueryOptions,
} from "../queries/chat-history-queries";
import { useMessageStore } from "./message-store";
import type { SessionEvent } from "../shared/types";
import type { DisplaySessionEvent } from "../shared/types/stream";

type FetchStatus = "idle" | "loading" | "ready" | "error";

const EMPTY_EVENTS: DisplaySessionEvent[] = [];
const IDLE_HISTORY = { events: EMPTY_EVENTS, status: "idle" as const, error: null };

type HistoryEntry = {
  events: DisplaySessionEvent[];
  status: FetchStatus;
  fetchedAt: number;
  error: string | null;
  lastMessageAt: string | null;
};

type ChatHistoryState = {
  entries: Record<string, HistoryEntry>;
  previewLastMessages: Record<string, DisplaySessionEvent>;
  /**
   * Keys that the LRU eviction in `withBoundedHistoryEntry` must NOT
   * drop, even when the entry table is over `MAX_HISTORY_ENTRIES`.
   * `useChatHistorySync` pins the active chat panel's `historyKey` for
   * the panel's lifetime so a background sidebar prefetch can never
   * evict the currently-displayed transcript out from under the
   * renderer (the original "CEO chat blink" failure mode).
   */
  pinnedKeys: Set<string>;
  fetchHistory: (
    key: string,
    fetchFn: () => Promise<SessionEvent[]>,
    opts?: { force?: boolean },
  ) => Promise<void>;
  prefetchHistory: (key: string, fetchFn: () => Promise<SessionEvent[]>) => void;
  invalidateHistory: (key: string) => void;
  clearHistory: (key: string) => void;
  pinKey: (key: string) => void;
  unpinKey: (key: string) => void;
  /**
   * Synchronously-ish populate the entry from IndexedDB if available.
   * Used by `useChatHistorySync` on mount so the chat view can paint
   * the last-seen transcript while the network revalidation is still
   * in flight — removing the spinner flash that used to follow every
   * cold browser reload.
   */
  hydrateFromCache: (key: string) => Promise<void>;
  /**
   * Prepend an older page of display events (from a paginated
   * "load older" fetch) above the entry's current events. Dedupes by
   * event id; no-ops when the entry isn't ready.
   */
  prependHistoryEvents: (key: string, olderEvents: DisplaySessionEvent[]) => void;
  /**
   * Copy a warm `"ready"` entry (events + preview bridge frame) to a
   * second key, marking it fresh so the destination surface resolves
   * `historyResolved === true` on its first render. Used when the same
   * conversation is rendered under two different transcript keys (the
   * Simple `/chat` `agent:<id>:session:<sid>` surface vs the Advanced
   * agents `session:<proj>:<inst>:<sid>` surface) so toggling the UI
   * mode paints the destination transcript immediately instead of
   * re-arming `ChatPanel`'s cold-load reveal. No-ops when the source
   * isn't ready or the destination is already warm + fresh.
   */
  aliasHistoryEntry: (fromKey: string, toKey: string) => void;
};

const HISTORY_TTL_MS = 30_000;
const ERROR_TTL_MS = 10_000;
const MAX_HISTORY_ENTRIES = 8;
const MAX_HISTORY_PREVIEW_ENTRIES = 100;
const MAX_HISTORY_EVENTS_PER_ENTRY = 500;
/**
 * Upper bound for an entry that has grown beyond the fetch window via
 * "load older" pagination prepends. Kept separate from
 * `MAX_HISTORY_EVENTS_PER_ENTRY` (which bounds a single fetched window
 * and the IndexedDB persistence payload) so paginated-up transcripts
 * aren't re-trimmed back to the window size on every entry rewrite.
 */
const MAX_HISTORY_EVENTS_HARD_CAP = 1500;

/**
 * Shape we round-trip through IndexedDB for a single history key.
 * Stored events are already in display form (produced by
 * `buildDisplayEvents`) so hydration is just a shallow copy.
 */
type PersistedHistory = {
  events: DisplaySessionEvent[];
  lastMessageAt: string | null;
  persistedAt: number;
};

function persistHistoryToCache(
  key: string,
  events: DisplaySessionEvent[],
  lastMessageAt: string | null,
): void {
  const boundedEvents = boundHistoryEvents(events);
  const payload: PersistedHistory = {
    events: boundedEvents,
    lastMessageAt,
    persistedAt: Date.now(),
  };
  void browserDbSet(BROWSER_DB_STORES.chatHistory, key, payload).catch((err) => {
    console.warn("[chat-history] persist failed for", key, err);
  });
}

function boundHistoryEvents(
  events: DisplaySessionEvent[],
  cap: number = MAX_HISTORY_EVENTS_PER_ENTRY,
): DisplaySessionEvent[] {
  return events.length > cap ? events.slice(-cap) : events;
}

/**
 * Preserve older pages the user loaded via pagination when a refetch
 * replaces the entry with a fresh tail window. The fetched window's
 * first event id is located in the current entry; everything before it
 * (previously prepended older pages) is kept as a prefix.
 */
function mergeFetchedWindow(
  current: DisplaySessionEvent[] | undefined,
  fetched: DisplaySessionEvent[],
): DisplaySessionEvent[] {
  if (!current || current.length === 0 || fetched.length === 0) return fetched;
  const firstFetchedId = fetched[0].id;
  const splitIndex = current.findIndex((event) => event.id === firstFetchedId);
  if (splitIndex <= 0) return fetched;
  return [...current.slice(0, splitIndex), ...fetched];
}

function withBoundedHistoryEntry(
  entries: Record<string, HistoryEntry>,
  pinnedKeys: Set<string>,
  key: string,
  entry: HistoryEntry,
): Record<string, HistoryEntry> {
  const next = {
    ...entries,
    [key]: {
      ...entry,
      events: boundHistoryEvents(entry.events, MAX_HISTORY_EVENTS_HARD_CAP),
    },
  };
  if (Object.keys(next).length <= MAX_HISTORY_ENTRIES) return next;
  // First pass: only evict non-pinned, non-active keys. This is the
  // hot path; pinned keys (the currently-displayed chat panel(s))
  // are protected from background sidebar prefetches that would
  // otherwise drop the active transcript and cause the renderer to
  // momentarily snap to the empty state ("CEO chat blink").
  for (const staleKey of Object.keys(next)) {
    if (staleKey === key) continue;
    if (pinnedKeys.has(staleKey)) continue;
    delete next[staleKey];
    if (Object.keys(next).length <= MAX_HISTORY_ENTRIES) break;
  }
  // Defensive fallback: if every other key was pinned and we are
  // still over the cap, fall back to evicting the oldest non-active
  // pinned key. This keeps the cache strictly bounded but is not
  // expected to trigger in practice — pin counts are bounded by the
  // number of mounted chat panels, well below `MAX_HISTORY_ENTRIES`.
  if (Object.keys(next).length > MAX_HISTORY_ENTRIES) {
    for (const staleKey of Object.keys(next)) {
      if (staleKey === key) continue;
      delete next[staleKey];
      if (Object.keys(next).length <= MAX_HISTORY_ENTRIES) break;
    }
  }
  return next;
}

function withBoundedHistoryPreview(
  previewLastMessages: Record<string, DisplaySessionEvent>,
  key: string,
  lastMessage: DisplaySessionEvent | undefined,
): Record<string, DisplaySessionEvent> {
  const next = { ...previewLastMessages };
  delete next[key];
  if (lastMessage) {
    next[key] = lastMessage;
  }

  const keys = Object.keys(next);
  if (keys.length <= MAX_HISTORY_PREVIEW_ENTRIES) return next;
  for (const staleKey of keys) {
    if (staleKey === key) continue;
    delete next[staleKey];
    if (Object.keys(next).length <= MAX_HISTORY_PREVIEW_ENTRIES) break;
  }
  return next;
}

/**
 * Cheap proxy for "the freshly-fetched snapshot is structurally
 * identical to what's already cached, so we can skip the rewrite and
 * preserve the existing entry's object identity". History is
 * append-only on the server, so matching `(length, lastMessageAt, tail
 * event id)` is sufficient: if the tail is the same and the count is
 * the same, every prior row is also the same. The earlier check ran
 * `JSON.stringify` per event on every resolve, which on cold open of
 * an 80-event session with multi-100KB tool-output blocks dominated
 * the main thread for hundreds of milliseconds. False positives only
 * arise if the server mutates an existing event without bumping
 * `lastMessageAt`; the next forced refetch picks them up anyway.
 */
function historySnapshotMatches(
  cachedEvents: DisplaySessionEvent[],
  cachedLastMessageAt: string | null,
  nextEvents: DisplaySessionEvent[],
  nextLastMessageAt: string | null,
): boolean {
  if (cachedEvents.length !== nextEvents.length) return false;
  if (cachedLastMessageAt !== nextLastMessageAt) return false;
  if (cachedEvents.length === 0) return true;
  const cachedTail = cachedEvents[cachedEvents.length - 1];
  const nextTail = nextEvents[nextEvents.length - 1];
  return cachedTail.id === nextTail.id;
}

export const useChatHistoryStore = create<ChatHistoryState>()((set, get) => ({
  entries: {},
  previewLastMessages: {},
  pinnedKeys: new Set<string>(),

  pinKey: (key): void => {
    set((s) => {
      if (s.pinnedKeys.has(key)) return s;
      const next = new Set(s.pinnedKeys);
      next.add(key);
      return { pinnedKeys: next };
    });
  },

  unpinKey: (key): void => {
    set((s) => {
      if (!s.pinnedKeys.has(key)) return s;
      const next = new Set(s.pinnedKeys);
      next.delete(key);
      return { pinnedKeys: next };
    });
  },

  fetchHistory: async (key, fetchFn, opts): Promise<void> => {
    const entry = get().entries[key];
    const now = Date.now();

    if (
      !opts?.force &&
      entry?.status === "ready" &&
      now - entry.fetchedAt < HISTORY_TTL_MS
    ) {
      return;
    }

    if (
      !opts?.force &&
      entry?.status === "error" &&
      entry.fetchedAt > 0 &&
      now - entry.fetchedAt < ERROR_TTL_MS
    ) {
      return;
    }

    if (!entry || entry.status !== "ready") {
      set((s) => ({
        entries: withBoundedHistoryEntry(
          s.entries,
          s.pinnedKeys,
          key,
          {
            events: entry?.events ?? EMPTY_EVENTS,
            status: "loading",
            fetchedAt: entry?.fetchedAt ?? 0,
            error: null,
            lastMessageAt: entry?.lastMessageAt ?? null,
          },
        ),
      }));
    }

    const promise = queryClient
      .fetchQuery({
        ...chatHistoryQueryOptions(key, fetchFn),
        staleTime: opts?.force ? 0 : CHAT_HISTORY_STALE_TIME_MS,
      })
      .then((data) => {
        const current = get().entries[key];
        // Preserve older pages prepended via pagination across refetches
        // (post-stream / WS-triggered fetches return only the tail window).
        const events = mergeFetchedWindow(
          current?.events,
          boundHistoryEvents(data.events),
        );
        const lastMessage = events.length ? events[events.length - 1] : undefined;
        if (
          current?.status === "ready" &&
          current.error == null &&
          historySnapshotMatches(
            current.events,
            current.lastMessageAt,
            events,
            data.lastMessageAt,
          )
        ) {
          useMessageStore.getState().setThread(key, events);
          return;
        }
        set((s) => ({
          entries: withBoundedHistoryEntry(
            s.entries,
            s.pinnedKeys,
            key,
            {
              events,
              status: "ready",
              fetchedAt: Date.now(),
              error: null,
              lastMessageAt: data.lastMessageAt,
            },
          ),
          previewLastMessages: withBoundedHistoryPreview(
            s.previewLastMessages,
            key,
            lastMessage,
          ),
        }));
        useMessageStore.getState().setThread(key, events);
        persistHistoryToCache(key, events, data.lastMessageAt);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Failed to fetch history";
        set((s) => ({
          entries: withBoundedHistoryEntry(
            s.entries,
            s.pinnedKeys,
            key,
            {
              events: entry?.events ?? EMPTY_EVENTS,
              status: "error",
              fetchedAt: Date.now(),
              error: message,
              lastMessageAt: entry?.lastMessageAt ?? null,
            },
          ),
        }));
      });

    return promise;
  },

  prefetchHistory: (key, fetchFn): void => {
    queryClient.prefetchQuery(chatHistoryQueryOptions(key, fetchFn)).catch((err) => {
      console.warn("[chat-history] prefetch failed for", key, err);
    });
  },

  invalidateHistory: (key): void => {
    void queryClient.invalidateQueries({
      queryKey: chatHistoryQueryKeys.history(key),
      exact: true,
    });
    useMessageStore.getState().clearThread(key);
    set((s) => {
      const entry = s.entries[key];
      if (!entry) return s;
      return {
        entries: {
          ...s.entries,
          [key]: { ...entry, fetchedAt: 0 },
        },
      };
    });
  },

  clearHistory: (key): void => {
    void queryClient.removeQueries({
      queryKey: chatHistoryQueryKeys.history(key),
      exact: true,
    });
    useMessageStore.getState().clearThread(key);
    set((s) => ({
      entries: withBoundedHistoryEntry(
        s.entries,
        s.pinnedKeys,
        key,
        {
          events: EMPTY_EVENTS,
          status: "ready",
          fetchedAt: Date.now(),
          error: null,
          lastMessageAt: null,
        },
      ),
      previewLastMessages: withBoundedHistoryPreview(
        s.previewLastMessages,
        key,
        undefined,
      ),
    }));
    void browserDbDelete(BROWSER_DB_STORES.chatHistory, key).catch(() => {});
  },

  hydrateFromCache: async (key): Promise<void> => {
    // Don't stomp an already-loaded entry. This is the common case after
    // the first navigation — subsequent mounts hit the in-memory cache
    // and never reach here.
    const existing = get().entries[key];
    if (existing && existing.status !== "idle") return;

    const persisted = await browserDbGet<PersistedHistory>(
      BROWSER_DB_STORES.chatHistory,
      key,
    );
    if (!persisted || !Array.isArray(persisted.events)) return;

    // Another concurrent `fetchHistory` may have beaten us to the store
    // (e.g. the view mounted, kicked off a fresh network fetch, and that
    // resolved before IDB). In that case the in-memory entry is fresher
    // than the cache — bail out.
    if (get().entries[key]?.status === "ready") return;

    const events = boundHistoryEvents(persisted.events);
    const lastMessage = events.length ? events[events.length - 1] : undefined;
    set((s) => ({
      entries: withBoundedHistoryEntry(
        s.entries,
        s.pinnedKeys,
        key,
        {
          events,
          status: "ready",
          // Mark as stale (persistedAt is typically older than the TTL)
          // so the caller's subsequent `fetchHistory(key, fn)` still
          // issues a network refetch. `useChatHistorySync`'s
          // `isFetchStale` check only matches `fetchedAt === 0`, so
          // using the real persisted timestamp here paints the cached
          // transcript immediately instead of queueing behind the
          // round-trip.
          fetchedAt: persisted.persistedAt || 1,
          error: null,
          lastMessageAt: persisted.lastMessageAt ?? null,
        },
      ),
      previewLastMessages: withBoundedHistoryPreview(
        s.previewLastMessages,
        key,
        lastMessage,
      ),
    }));
    useMessageStore.getState().setThread(key, events);
  },

  prependHistoryEvents: (key, olderEvents): void => {
    if (olderEvents.length === 0) return;
    set((s) => {
      const entry = s.entries[key];
      if (!entry || entry.status !== "ready") return s;
      const existingIds = new Set(entry.events.map((event) => event.id));
      const fresh = olderEvents.filter((event) => !existingIds.has(event.id));
      if (fresh.length === 0) return s;
      return {
        entries: withBoundedHistoryEntry(s.entries, s.pinnedKeys, key, {
          ...entry,
          events: [...fresh, ...entry.events],
        }),
      };
    });
    const updated = get().entries[key];
    if (updated) {
      useMessageStore.getState().setThread(key, updated.events);
    }
  },

  aliasHistoryEntry: (fromKey, toKey): void => {
    if (fromKey === toKey) return;
    const source = get().entries[fromKey];
    if (!source || source.status !== "ready") return;
    const existing = get().entries[toKey];
    // Don't clobber a destination that is already warm + fresh — it
    // either carries newer data or is mid-revalidation.
    if (existing?.status === "ready" && existing.fetchedAt > 0) return;

    const lastMessage = source.events.length
      ? source.events[source.events.length - 1]
      : undefined;
    set((s) => {
      // Briefly pin the destination so the LRU can't evict the warmed
      // slot before the destination panel mounts and pins it itself
      // (mirrors the sidebar hover-warm pattern in `ChatAppLeftPanel`).
      const pinnedKeys = new Set(s.pinnedKeys);
      pinnedKeys.add(toKey);
      return {
        entries: withBoundedHistoryEntry(s.entries, pinnedKeys, toKey, {
          events: source.events,
          status: "ready",
          fetchedAt: Date.now(),
          error: null,
          lastMessageAt: source.lastMessageAt,
        }),
        previewLastMessages: withBoundedHistoryPreview(
          s.previewLastMessages,
          toKey,
          lastMessage,
        ),
        pinnedKeys,
      };
    });
    useMessageStore.getState().setThread(toKey, source.events);
    setTimeout(() => {
      get().unpinKey(toKey);
    }, HISTORY_TTL_MS);
  },
}));

export function useChatHistory(key: string | undefined): {
  events: DisplaySessionEvent[];
  status: FetchStatus;
  error: string | null;
} {
  return useChatHistoryStore(
    useShallow((s) => {
      if (!key) return IDLE_HISTORY;
      const entry = s.entries[key];
      return entry
        ? { events: entry.events, status: entry.status, error: entry.error }
        : IDLE_HISTORY;
    }),
  );
}

export function agentHistoryKey(agentId: string): string {
  return `agent:${agentId}`;
}

/**
 * History key for a specific session as read by the Simple `/chat`
 * surface (`useStandaloneAgentChat`). Kept in sync with the inline
 * key construction there and in `ChatAppLeftPanel`'s hover-warm.
 */
export function agentSessionHistoryKey(agentId: string, sessionId: string): string {
  return `agent:${agentId}:session:${sessionId}`;
}

export function projectChatHistoryKey(projectId: string, agentInstanceId: string): string {
  return `project:${projectId}:${agentInstanceId}`;
}

/**
 * History key for a specific session view inside the project-agent
 * chat panel. Mirrors the memo in `AgentChatPanel` and the
 * resolver in `useAgentsShellTarget`; centralising the key shape here
 * lets sidebar prefetchers warm the exact slot the panel will read on
 * mount, so navigating into a session no longer triggers a cold-load
 * reveal cycle (overlay flash + `visibility: hidden` flicker).
 */
export function sessionHistoryKey(
  projectId: string,
  agentInstanceId: string,
  sessionId: string,
): string {
  return `session:${projectId}:${agentInstanceId}:${sessionId}`;
}
