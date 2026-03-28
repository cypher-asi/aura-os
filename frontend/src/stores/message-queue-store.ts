import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { ChatAttachment } from "../api/streams";

export interface QueuedMessage {
  id: string;
  content: string;
  action: string | null;
  attachments?: ChatAttachment[];
  commands?: string[];
}

interface MessageQueueState {
  queues: Record<string, QueuedMessage[]>;
  enqueue: (streamKey: string, msg: Omit<QueuedMessage, "id">) => void;
  dequeue: (streamKey: string) => QueuedMessage | undefined;
  remove: (streamKey: string, id: string) => void;
  editContent: (streamKey: string, id: string, content: string) => void;
  moveUp: (streamKey: string, id: string) => void;
  clear: (streamKey: string) => void;
}

const EMPTY: QueuedMessage[] = [];

export const useMessageQueueStore = create<MessageQueueState>()((set, get) => ({
  queues: {},

  enqueue: (streamKey, msg) => {
    set((s) => {
      const prev = s.queues[streamKey] ?? EMPTY;
      const entry: QueuedMessage = { ...msg, id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
      return { queues: { ...s.queues, [streamKey]: [...prev, entry] } };
    });
  },

  dequeue: (streamKey) => {
    const queue = get().queues[streamKey];
    if (!queue || queue.length === 0) return undefined;
    const [first, ...rest] = queue;
    set((s) => ({ queues: { ...s.queues, [streamKey]: rest } }));
    return first;
  },

  remove: (streamKey, id) => {
    set((s) => {
      const prev = s.queues[streamKey];
      if (!prev) return s;
      return { queues: { ...s.queues, [streamKey]: prev.filter((m) => m.id !== id) } };
    });
  },

  editContent: (streamKey, id, content) => {
    set((s) => {
      const prev = s.queues[streamKey];
      if (!prev) return s;
      return {
        queues: {
          ...s.queues,
          [streamKey]: prev.map((m) => (m.id === id ? { ...m, content } : m)),
        },
      };
    });
  },

  moveUp: (streamKey, id) => {
    set((s) => {
      const prev = s.queues[streamKey];
      if (!prev) return s;
      const idx = prev.findIndex((m) => m.id === id);
      if (idx <= 0) return s;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return { queues: { ...s.queues, [streamKey]: next } };
    });
  },

  clear: (streamKey) => {
    set((s) => {
      const prev = s.queues[streamKey];
      if (!prev || prev.length === 0) return s;
      return { queues: { ...s.queues, [streamKey]: EMPTY } };
    });
  },
}));

export function useMessageQueue(streamKey: string): QueuedMessage[] {
  return useMessageQueueStore(
    useShallow((s) => s.queues[streamKey] ?? EMPTY),
  );
}
