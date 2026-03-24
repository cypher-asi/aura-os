import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { buildDisplayMessages } from "../utils/build-display-messages";
import type { Message } from "../types";
import type { DisplayMessage } from "../types/stream";

type FetchStatus = "idle" | "loading" | "ready" | "error";

const EMPTY_MESSAGES: DisplayMessage[] = [];
const IDLE_HISTORY = { messages: EMPTY_MESSAGES, status: "idle" as const, error: null };

type HistoryEntry = {
  messages: DisplayMessage[];
  status: FetchStatus;
  fetchedAt: number;
  error: string | null;
  lastMessageAt: string | null;
};

type ChatHistoryState = {
  entries: Record<string, HistoryEntry>;
  fetchHistory: (
    key: string,
    fetchFn: () => Promise<Message[]>,
    opts?: { force?: boolean },
  ) => Promise<void>;
  prefetchHistory: (key: string, fetchFn: () => Promise<Message[]>) => void;
  invalidateHistory: (key: string) => void;
};

const HISTORY_TTL_MS = 30_000;
const ERROR_TTL_MS = 10_000;
const inflightPromises = new Map<string, Promise<void>>();

export const useChatHistoryStore = create<ChatHistoryState>()((set, get) => ({
  entries: {},

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

    const existing = inflightPromises.get(key);
    if (existing) return existing;

    if (!entry || entry.status !== "ready") {
      set((s) => ({
        entries: {
          ...s.entries,
          [key]: {
            messages: entry?.messages ?? EMPTY_MESSAGES,
            status: "loading",
            fetchedAt: entry?.fetchedAt ?? 0,
            error: null,
            lastMessageAt: entry?.lastMessageAt ?? null,
          },
        },
      }));
    }

    const promise = fetchFn()
      .then((raw) => {
        const messages = buildDisplayMessages(raw);
        const lastMessageAt = raw.length > 0 ? raw[raw.length - 1].created_at : null;
        set((s) => ({
          entries: {
            ...s.entries,
            [key]: { messages, status: "ready", fetchedAt: Date.now(), error: null, lastMessageAt },
          },
        }));
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Failed to fetch history";
        set((s) => ({
          entries: {
            ...s.entries,
            [key]: {
              messages: entry?.messages ?? EMPTY_MESSAGES,
              status: "error",
              fetchedAt: Date.now(),
              error: message,
              lastMessageAt: entry?.lastMessageAt ?? null,
            },
          },
        }));
      })
      .finally(() => {
        inflightPromises.delete(key);
      });

    inflightPromises.set(key, promise);
    return promise;
  },

  prefetchHistory: (key, fetchFn): void => {
    get().fetchHistory(key, fetchFn).catch(() => {});
  },

  invalidateHistory: (key): void => {
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
}));

export function useChatHistory(key: string | undefined): {
  messages: DisplayMessage[];
  status: FetchStatus;
  error: string | null;
} {
  return useChatHistoryStore(
    useShallow((s) => {
      if (!key) return IDLE_HISTORY;
      const entry = s.entries[key];
      return entry
        ? { messages: entry.messages, status: entry.status, error: entry.error }
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
