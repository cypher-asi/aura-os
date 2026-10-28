import { describe, it, expect, beforeEach, vi } from "vitest";

const persistence = vi.hoisted(() => ({
  stored: [] as unknown[],
  outbox: [] as unknown[],
  durableError: null as Error | null,
}));
const auth = vi.hoisted(() => ({ ownerId: "user-1" as string | null }));

vi.mock("../shared/lib/auth-token", () => ({
  getStoredSession: () => auth.ownerId ? { user_id: auth.ownerId } : null,
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
  moveQueuedMessage,
  MessageQueueUnavailableError,
  resumeQueuedMessages,
  takeNextQueuedMessage,
  useMessageQueueStore,
} from "./message-queue-store";

beforeEach(() => {
  auth.ownerId = "user-1";
  persistence.stored = [];
  persistence.outbox = [];
  persistence.durableError = null;
  _resetMessageQueuePersistenceForTests();
  vi.clearAllMocks();
});

describe("message-queue-store", () => {
  describe("durable reordering", () => {
    it("restores ordering and preserves attachment and execution context", async () => {
      const first = await enqueueQueuedMessage("s", { content: "first", action: null });
      const second = await enqueueQueuedMessage("s", {
        content: "second", action: "run", model: "selected-model", commands: ["test"],
        attachments: [{ type: "text", media_type: "text/plain", data: "日本語" }],
        sourceImageUrl: "https://example.test/source.png",
      });
      await moveQueuedMessage("s", second.id, "up");
      expect(useMessageQueueStore.getState().queues.s).toEqual([second, first]);
      _resetMessageQueuePersistenceForTests();
      await hydrateMessageQueues();
      expect(useMessageQueueStore.getState().queues.s).toEqual([
        { ...second, heldAfterRestart: true }, { ...first, heldAfterRestart: true },
      ]);
      expect(await takeNextQueuedMessage("s")).toBeUndefined();
      await resumeQueuedMessages("s");
      expect((await takeNextQueuedMessage("s"))?.id).toBe(second.id);
    });

    it("never swaps a neighboring record belonging to another queue, owner, or host", async () => {
      const first = await enqueueQueuedMessage("s", { content: "first", action: null });
      const second = await enqueueQueuedMessage("s", { content: "second", action: null });
      const template = persistence.stored[0] as Record<string, unknown>;
      const other = [
        { ...template, id: "other-stream", streamKey: "other" },
        { ...template, id: "other-owner", ownerId: "user-2" },
        { ...template, id: "other-host", hostOrigin: "https://other.example" },
      ];
      persistence.stored.splice(1, 0, ...other);
      await moveQueuedMessage("s", first.id, "down");
      expect(persistence.stored.slice(1, 4)).toEqual(other);
      expect(useMessageQueueStore.getState().queues.s.map((item) => item.id)).toEqual([second.id, first.id]);
    });

    it("keeps the previous order when durable storage fails", async () => {
      await enqueueQueuedMessage("s", { content: "first", action: null });
      const second = await enqueueQueuedMessage("s", { content: "second", action: null });
      const before = useMessageQueueStore.getState().queues.s;
      const stored = structuredClone(persistence.stored);
      persistence.durableError = new Error("quota");
      await expect(moveQueuedMessage("s", second.id, "up")).rejects.toThrow("quota");
      expect(useMessageQueueStore.getState().queues.s).toBe(before);
      expect(persistence.stored).toEqual(stored);
    });

    it("serializes reorder with dispatch and ignores missing or boundary rows", async () => {
      const first = await enqueueQueuedMessage("s", { content: "first", action: null });
      const second = await enqueueQueuedMessage("s", { content: "second", action: null });
      await moveQueuedMessage("s", first.id, "up");
      await moveQueuedMessage("s", second.id, "down");
      await moveQueuedMessage("s", "missing", "up");
      expect(useMessageQueueStore.getState().queues.s.map((item) => item.id)).toEqual([first.id, second.id]);
      const [, sent] = await Promise.all([moveQueuedMessage("s", second.id, "up"), takeNextQueuedMessage("s")]);
      expect(sent?.id).toBe(second.id);
      expect(useMessageQueueStore.getState().queues.s.map((item) => item.id)).toEqual([first.id]);
    });

    it("supports public in-memory queues without writing authenticated storage", async () => {
      auth.ownerId = null;
      const store = useMessageQueueStore.getState();
      store.enqueue("public", { content: "first", action: null });
      store.enqueue("public", { content: "second", action: null });
      const second = useMessageQueueStore.getState().queues.public[1];
      await moveQueuedMessage("public", second.id, "up");
      expect(useMessageQueueStore.getState().queues.public.map((item) => item.content)).toEqual(["second", "first"]);
      expect(persistence.stored).toEqual([]);
    });
  });
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
