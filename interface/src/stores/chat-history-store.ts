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
  fetchHistory: (
    key: string,
    fetchFn: () => Promise<SessionEvent[]>,
    opts?: { force?: boolean },
  ) => Promise<void>;
  prefetchHistory: (key: string, fetchFn: () => Promise<SessionEvent[]>) => void;
  invalidateHistory: (key: string) => void;
  clearHistory: (key: string) => void;
  /**
   * Synchronously-ish populate the entry from IndexedDB if available.
   * Used by `useChatHistorySync` on mount so the chat view can paint
   * the last-seen transcript while the network revalidation is still
   * in flight — removing the spinner flash that used to follow every
   * cold browser reload.
   */
  hydrateFromCache: (key: string) => Promise<void>;
};

const HISTORY_TTL_MS = 30_000;
const ERROR_TTL_MS = 10_000;
const MAX_HISTORY_ENTRIES = 8;
const MAX_HISTORY_PREVIEW_ENTRIES = 100;
const MAX_HISTORY_EVENTS_PER_ENTRY = 500;

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

function boundHistoryEvents(events: DisplaySessionEvent[]): DisplaySessionEvent[] {
  return events.length > MAX_HISTORY_EVENTS_PER_ENTRY
    ? events.slice(-MAX_HISTORY_EVENTS_PER_ENTRY)
    : events;
}

function withBoundedHistoryEntry(
  entries: Record<string, HistoryEntry>,
  key: string,
  entry: HistoryEntry,
): Record<string, HistoryEntry> {
  const next = { ...entries, [key]: { ...entry, events: boundHistoryEvents(entry.events) } };
  const keys = Object.keys(next);
  if (keys.length <= MAX_HISTORY_ENTRIES) return next;
  for (const staleKey of keys) {
    if (staleKey === key) continue;
    delete next[staleKey];
    if (Object.keys(next).length <= MAX_HISTORY_ENTRIES) break;
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

export const useChatHistoryStore = create<ChatHistoryState>()((set, get) => ({
  entries: {},
  previewLastMessages: {},

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
        const events = boundHistoryEvents(data.events);
        const lastMessage = events.length ? events[events.length - 1] : undefined;
        set((s) => ({
          entries: withBoundedHistoryEntry(
            s.entries,
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

export function projectChatHistoryKey(projectId: string, agentInstanceId: string): string {
  return `project:${projectId}:${agentInstanceId}`;
}
