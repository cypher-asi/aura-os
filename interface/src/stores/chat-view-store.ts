import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

export interface ThreadViewState {
  olderCursor: string | null;
  newerCursor: string | null;
  hasOlderMessages: boolean;
  pinnedToBottom: boolean;
  unreadCount: number;
}

const DEFAULT_THREAD_VIEW: ThreadViewState = {
  olderCursor: null,
  newerCursor: null,
  hasOlderMessages: false,
  pinnedToBottom: true,
  unreadCount: 0,
};

interface ChatViewState {
  threads: Record<string, ThreadViewState>;

  getThreadView: (threadKey: string) => ThreadViewState;
  setPinnedToBottom: (threadKey: string, pinned: boolean) => void;
  setOlderCursor: (threadKey: string, cursor: string | null) => void;
  setNewerCursor: (threadKey: string, cursor: string | null) => void;
  setHasOlderMessages: (threadKey: string, has: boolean) => void;
  incrementUnread: (threadKey: string) => void;
  resetUnread: (threadKey: string) => void;
  resetThread: (threadKey: string) => void;
}

export const useChatViewStore = create<ChatViewState>()((set, get) => ({
  threads: {},

  getThreadView: (threadKey) => {
    return get().threads[threadKey] ?? DEFAULT_THREAD_VIEW;
  },

  setPinnedToBottom: (threadKey, pinned) => {
    set((s) => ({
      threads: {
        ...s.threads,
        [threadKey]: {
          ...(s.threads[threadKey] ?? DEFAULT_THREAD_VIEW),
          pinnedToBottom: pinned,
        },
      },
    }));
  },

  setOlderCursor: (threadKey, cursor) => {
    set((s) => ({
      threads: {
        ...s.threads,
        [threadKey]: {
          ...(s.threads[threadKey] ?? DEFAULT_THREAD_VIEW),
          olderCursor: cursor,
        },
      },
    }));
  },

  setNewerCursor: (threadKey, cursor) => {
    set((s) => ({
      threads: {
        ...s.threads,
        [threadKey]: {
          ...(s.threads[threadKey] ?? DEFAULT_THREAD_VIEW),
          newerCursor: cursor,
        },
      },
    }));
  },

  setHasOlderMessages: (threadKey, has) => {
    set((s) => ({
      threads: {
        ...s.threads,
        [threadKey]: {
          ...(s.threads[threadKey] ?? DEFAULT_THREAD_VIEW),
          hasOlderMessages: has,
        },
      },
    }));
  },

  incrementUnread: (threadKey) => {
    set((s) => {
      const existing = s.threads[threadKey] ?? DEFAULT_THREAD_VIEW;
      return {
        threads: {
          ...s.threads,
          [threadKey]: {
            ...existing,
            unreadCount: existing.unreadCount + 1,
          },
        },
      };
    });
  },

  resetUnread: (threadKey) => {
    set((s) => {
      const existing = s.threads[threadKey];
      if (!existing || existing.unreadCount === 0) return s;
      return {
        threads: {
          ...s.threads,
          [threadKey]: { ...existing, unreadCount: 0 },
        },
      };
    });
  },

  resetThread: (threadKey) => {
    set((s) => {
      const existing = s.threads[threadKey];
      if (!existing) return s;
      const newThreads = { ...s.threads };
      delete newThreads[threadKey];
      return { threads: newThreads };
    });
  },
}));

/**
 * Reactive hook that returns view state for a thread.
 * Only re-renders when the specific thread's view state changes.
 */
export function useThreadView(threadKey: string): ThreadViewState {
  return useChatViewStore(
    useShallow((s) => s.threads[threadKey] ?? DEFAULT_THREAD_VIEW),
  );
}
