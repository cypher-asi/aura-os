import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { DisplaySessionEvent } from "../shared/types/stream";

const EMPTY_MESSAGES: DisplaySessionEvent[] = [];

interface MessageStoreState {
  /** Normalized map: message ID -> message */
  messages: Record<string, DisplaySessionEvent>;
  /** Stable ordered array of message IDs per thread key */
  orderedIds: Record<string, string[]>;

  /** Insert messages for a thread (idempotent, appends new messages at end) */
  insertMessages: (threadKey: string, msgs: DisplaySessionEvent[]) => void;
  /** Prepend older messages to the beginning of a thread */
  prependMessages: (threadKey: string, msgs: DisplaySessionEvent[]) => void;
  /** Append a single message to the end of a thread */
  appendMessage: (threadKey: string, msg: DisplaySessionEvent) => void;
  /** Replace all messages for a thread (used on initial history load) */
  setThread: (threadKey: string, msgs: DisplaySessionEvent[]) => void;
  /** Get ordered messages for a thread */
  getThreadMessages: (threadKey: string) => DisplaySessionEvent[];
  /** Clear a thread */
  clearThread: (threadKey: string) => void;
}

export const useMessageStore = create<MessageStoreState>()((set, get) => ({
  messages: {},
  orderedIds: {},

  insertMessages: (threadKey, msgs) => {
    if (msgs.length === 0) return;
    set((s) => {
      const existingIds = s.orderedIds[threadKey] ?? [];
      const existingSet = new Set(existingIds);
      const newMessages = { ...s.messages };
      const newIds = [...existingIds];

      for (const msg of msgs) {
        newMessages[msg.id] = msg;
        if (!existingSet.has(msg.id)) {
          newIds.push(msg.id);
          existingSet.add(msg.id);
        }
      }

      return {
        messages: newMessages,
        orderedIds: { ...s.orderedIds, [threadKey]: newIds },
      };
    });
  },

  prependMessages: (threadKey, msgs) => {
    if (msgs.length === 0) return;
    set((s) => {
      const existingIds = s.orderedIds[threadKey] ?? [];
      const existingSet = new Set(existingIds);
      const newMessages = { ...s.messages };
      const prependedIds: string[] = [];

      for (const msg of msgs) {
        newMessages[msg.id] = msg;
        if (!existingSet.has(msg.id)) {
          prependedIds.push(msg.id);
        }
      }

      return {
        messages: newMessages,
        orderedIds: {
          ...s.orderedIds,
          [threadKey]: [...prependedIds, ...existingIds],
        },
      };
    });
  },

  appendMessage: (threadKey, msg) => {
    set((s) => {
      const existingIds = s.orderedIds[threadKey] ?? [];
      if (existingIds.includes(msg.id)) {
        return {
          messages: { ...s.messages, [msg.id]: msg },
          orderedIds: s.orderedIds,
        };
      }
      return {
        messages: { ...s.messages, [msg.id]: msg },
        orderedIds: {
          ...s.orderedIds,
          [threadKey]: [...existingIds, msg.id],
        },
      };
    });
  },

  setThread: (threadKey, msgs) => {
    set((s) => {
      const newMessages = { ...s.messages };
      const ids: string[] = [];

      for (const msg of msgs) {
        newMessages[msg.id] = msg;
        ids.push(msg.id);
      }

      return {
        messages: newMessages,
        orderedIds: { ...s.orderedIds, [threadKey]: ids },
      };
    });
  },

  getThreadMessages: (threadKey) => {
    const { messages, orderedIds } = get();
    const ids = orderedIds[threadKey];
    if (!ids || ids.length === 0) return EMPTY_MESSAGES;

    const result: DisplaySessionEvent[] = [];
    for (const id of ids) {
      const msg = messages[id];
      if (msg) result.push(msg);
    }
    return result;
  },

  clearThread: (threadKey) => {
    set((s) => {
      const ids = s.orderedIds[threadKey];
      if (!ids) return s;

      const allThreadIds = new Set<string>();
      for (const [key, threadIds] of Object.entries(s.orderedIds)) {
        if (key === threadKey) continue;
        for (const id of threadIds) allThreadIds.add(id);
      }

      const newMessages = { ...s.messages };
      for (const id of ids) {
        if (!allThreadIds.has(id)) {
          delete newMessages[id];
        }
      }

      const newOrderedIds = { ...s.orderedIds };
      delete newOrderedIds[threadKey];

      return { messages: newMessages, orderedIds: newOrderedIds };
    });
  },
}));

/**
 * Reactive hook that returns ordered messages for a thread.
 * Only re-renders when the thread's message IDs or message contents change.
 */
export function useThreadMessages(threadKey: string): DisplaySessionEvent[] {
  return useMessageStore(
    useShallow((s) => {
      const ids = s.orderedIds[threadKey];
      if (!ids || ids.length === 0) return EMPTY_MESSAGES;
      const result: DisplaySessionEvent[] = [];
      for (const id of ids) {
        const msg = s.messages[id];
        if (msg) result.push(msg);
      }
      return result;
    }),
  );
}
