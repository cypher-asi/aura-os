import { describe, it, expect, beforeEach, vi } from "vitest";
import { useMessageQueueStore } from "./message-queue-store";

beforeEach(() => {
  useMessageQueueStore.setState({ queues: {} });
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
});
