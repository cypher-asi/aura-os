import { describe, it, expect, beforeEach, vi } from "vitest";

const persistence = vi.hoisted(() => ({
  stored: [] as unknown[],
  outbox: [] as unknown[],
  durableError: null as Error | null,
}));

vi.mock("../shared/lib/auth-token", () => ({
  getStoredSession: () => ({ user_id: "user-1" }),
}));

vi.mock("../shared/lib/host-config", () => ({
  getResolvedHostOrigin: () => "https://environment-1.example",
}));

vi.mock("../shared/lib/browser-db", () => ({
  BROWSER_DB_STORES: {
    chatFollowUpQueue: "chatFollowUpQueue",
    chatCommandOutbox: "chatCommandOutbox",
  },
  browserDbGet: vi.fn(async (store: string) => structuredClone(
    store === "chatCommandOutbox" ? persistence.outbox : persistence.stored,
  )),
  browserDbSetDurable: vi.fn(async (store: string, _key: string, value: unknown[]) => {
    if (persistence.durableError) throw persistence.durableError;
    if (store === "chatCommandOutbox") persistence.outbox = structuredClone(value);
    else persistence.stored = structuredClone(value);
  }),
}));

import {
  _resetMessageQueuePersistenceForTests,
  enqueueQueuedMessage,
  hydrateMessageQueues,
  MessageQueueUnavailableError,
  resumeQueuedMessages,
  takeNextQueuedMessage,
  useMessageQueueStore,
} from "./message-queue-store";

beforeEach(() => {
  persistence.stored = [];
  persistence.outbox = [];
  persistence.durableError = null;
  _resetMessageQueuePersistenceForTests();
  vi.clearAllMocks();
});

describe("message-queue-store", () => {
  describe("initial state", () => {
    it("starts with empty queues", () => {
      expect(useMessageQueueStore.getState().queues).toEqual({});
    });
  });

  describe("enqueue", () => {
    it("adds a message to the queue", () => {
      useMessageQueueStore.getState().enqueue("s1", {
        content: "hello",
        action: null,
      });
      const queue = useMessageQueueStore.getState().queues["s1"];
      expect(queue).toHaveLength(1);
      expect(queue[0].content).toBe("hello");
      expect(queue[0].action).toBeNull();
      expect(queue[0].id).toMatch(/^q-/);
    });

    it("appends to existing queue", () => {
      const store = useMessageQueueStore.getState();
      store.enqueue("s1", { content: "first", action: null });
      store.enqueue("s1", { content: "second", action: null });
      expect(useMessageQueueStore.getState().queues["s1"]).toHaveLength(2);
    });

    it("stores attachments and commands", () => {
      useMessageQueueStore.getState().enqueue("s1", {
        content: "msg",
        action: "run",
        attachments: [{ type: "text", media_type: "text/plain", data: "hi" }],
        commands: ["echo hi"],
      });
      const entry = useMessageQueueStore.getState().queues["s1"][0];
      expect(entry.attachments).toHaveLength(1);
      expect(entry.commands).toEqual(["echo hi"]);
    });
  });

  describe("dequeue", () => {
    it("removes and returns the first message", () => {
      const store = useMessageQueueStore.getState();
      store.enqueue("s1", { content: "first", action: null });
      store.enqueue("s1", { content: "second", action: null });
      const msg = useMessageQueueStore.getState().dequeue("s1");
      expect(msg?.content).toBe("first");
      expect(useMessageQueueStore.getState().queues["s1"]).toHaveLength(1);
    });

    it("returns undefined for empty queue", () => {
      expect(useMessageQueueStore.getState().dequeue("s1")).toBeUndefined();
    });

    it("returns undefined for non-existent stream", () => {
      expect(useMessageQueueStore.getState().dequeue("nonexistent")).toBeUndefined();
    });
  });

  describe("remove", () => {
    it("removes a specific message by id", () => {
      useMessageQueueStore.getState().enqueue("s1", { content: "a", action: null });
      useMessageQueueStore.getState().enqueue("s1", { content: "b", action: null });
      const id = useMessageQueueStore.getState().queues["s1"][0].id;
      useMessageQueueStore.getState().remove("s1", id);
      const queue = useMessageQueueStore.getState().queues["s1"];
      expect(queue).toHaveLength(1);
      expect(queue[0].content).toBe("b");
    });

    it("is a no-op for non-existent stream", () => {
      const before = useMessageQueueStore.getState();
      useMessageQueueStore.getState().remove("nope", "id");
      expect(useMessageQueueStore.getState()).toBe(before);
    });
  });

  describe("editContent", () => {
    it("updates the content of a queued message", () => {
      useMessageQueueStore.getState().enqueue("s1", { content: "old", action: null });
      const id = useMessageQueueStore.getState().queues["s1"][0].id;
      useMessageQueueStore.getState().editContent("s1", id, "new");
      expect(useMessageQueueStore.getState().queues["s1"][0].content).toBe("new");
    });

    it("is a no-op for non-existent stream", () => {
      const before = useMessageQueueStore.getState();
      useMessageQueueStore.getState().editContent("nope", "id", "x");
      expect(useMessageQueueStore.getState()).toBe(before);
    });
  });

  describe("moveUp", () => {
    it("swaps a message with the one before it", () => {
      const store = useMessageQueueStore.getState();
      store.enqueue("s1", { content: "a", action: null });
      store.enqueue("s1", { content: "b", action: null });
      store.enqueue("s1", { content: "c", action: null });
      const id = useMessageQueueStore.getState().queues["s1"][2].id;
      useMessageQueueStore.getState().moveUp("s1", id);
      const contents = useMessageQueueStore.getState().queues["s1"].map((m) => m.content);
      expect(contents).toEqual(["a", "c", "b"]);
    });

    it("is a no-op for the first item", () => {
      useMessageQueueStore.getState().enqueue("s1", { content: "a", action: null });
      const id = useMessageQueueStore.getState().queues["s1"][0].id;
      const before = useMessageQueueStore.getState();
      useMessageQueueStore.getState().moveUp("s1", id);
      expect(useMessageQueueStore.getState()).toBe(before);
    });

    it("is a no-op for non-existent stream", () => {
      const before = useMessageQueueStore.getState();
      useMessageQueueStore.getState().moveUp("nope", "id");
      expect(useMessageQueueStore.getState()).toBe(before);
    });
  });

  describe("clear", () => {
    it("empties the queue for a stream", () => {
      useMessageQueueStore.getState().enqueue("s1", { content: "a", action: null });
      useMessageQueueStore.getState().enqueue("s1", { content: "b", action: null });
      useMessageQueueStore.getState().clear("s1");
      expect(useMessageQueueStore.getState().queues["s1"]).toHaveLength(0);
    });

    it("is a no-op for already-empty queue", () => {
      useMessageQueueStore.getState().enqueue("s1", { content: "a", action: null });
      useMessageQueueStore.getState().clear("s1");
      const before = useMessageQueueStore.getState();
      useMessageQueueStore.getState().clear("s1");
      expect(useMessageQueueStore.getState()).toBe(before);
    });

    it("is a no-op for non-existent stream", () => {
      const before = useMessageQueueStore.getState();
      useMessageQueueStore.getState().clear("nope");
      expect(useMessageQueueStore.getState()).toBe(before);
    });
  });

  describe("durable mobile recovery", () => {
    it("persists the exact attachment-bearing follow-up before publishing it", async () => {
      const attachment = {
        type: "image" as const,
        media_type: "image/png",
        data: "aGVsbG8=",
        name: "screen.png",
      };

      const entry = await enqueueQueuedMessage("agent:a:session:s", {
        content: "Review this screenshot",
        action: null,
        attachments: [attachment],
      });

      expect(persistence.stored).toEqual([
        expect.objectContaining({
          id: entry.id,
          ownerId: "user-1",
          hostOrigin: "https://environment-1.example",
          streamKey: "agent:a:session:s",
          content: "Review this screenshot",
          attachments: [attachment],
          heldAfterRestart: false,
        }),
      ]);
      expect(useMessageQueueStore.getState().queues["agent:a:session:s"]).toEqual([
        expect.objectContaining({ id: entry.id, attachments: [attachment] }),
      ]);
    });

    it("keeps the composer-owned intent out of memory when durable storage fails", async () => {
      persistence.durableError = new Error("quota");

      await expect(
        enqueueQueuedMessage("agent:a:session:s", {
          content: "Do not lose me",
          action: null,
        }),
      ).rejects.toBeInstanceOf(MessageQueueUnavailableError);

      expect(useMessageQueueStore.getState().queues).toEqual({});
    });

    it("restores queued work as held and requires resume before taking it", async () => {
      persistence.stored = [
        {
          id: "q-restored",
          ownerId: "user-1",
          hostOrigin: "https://environment-1.example",
          streamKey: "agent:a:session:s",
          createdAt: Date.now(),
          content: "Continue after restart",
          action: null,
          heldAfterRestart: false,
        },
      ];

      await hydrateMessageQueues();

      expect(useMessageQueueStore.getState().queues["agent:a:session:s"][0])
        .toMatchObject({ id: "q-restored", heldAfterRestart: true });
      await expect(takeNextQueuedMessage("agent:a:session:s")).resolves.toBeUndefined();

      await resumeQueuedMessages("agent:a:session:s");
      await expect(takeNextQueuedMessage("agent:a:session:s")).resolves.toMatchObject({
        id: "q-restored",
        content: "Continue after restart",
        heldAfterRestart: false,
      });
      expect(persistence.stored).toEqual([]);
    });

    it("drops a recovered queue copy after the same id reached the command outbox", async () => {
      persistence.stored = [
        {
          id: "q-handed-off",
          ownerId: "user-1",
          hostOrigin: "https://environment-1.example",
          streamKey: "agent:a:session:s",
          createdAt: Date.now(),
          content: "Already handed off",
          action: null,
        },
      ];
      persistence.outbox = [
        {
          commandId: "q-handed-off",
          ownerId: "user-1",
          hostOrigin: "https://environment-1.example",
        },
      ];

      await hydrateMessageQueues();

      expect(useMessageQueueStore.getState().queues).toEqual({});
      expect(persistence.stored).toEqual([]);
    });
  });
});
