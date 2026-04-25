import type { DisplaySessionEvent } from "../../shared/types/stream";
import {
  useStreamStore,
  streamMetaMap,
  storeKey,
  ensureEntry,
  pruneStreamStore,
  getStreamEntry,
  getIsStreaming,
  getThinkingDurationMs,
  createSetters,
  resolve,
  seedStreamEventsFromCache,
  acquireSharedStreamSubscriptions,
  peekSharedSubscriptionRefCount,
} from "./store";

function makeEvent(id: string, content: string): DisplaySessionEvent {
  return { id, role: "assistant", content };
}

describe("stream/store", () => {
  beforeEach(() => {
    streamMetaMap.clear();
    useStreamStore.setState({ entries: {} });
  });

  describe("storeKey", () => {
    it("joins non-falsy deps with colon", () => {
      expect(storeKey(["a", "b", "c"])).toBe("a:b:c");
    });

    it("filters out falsy values", () => {
      expect(storeKey([undefined, "a", null, "b", ""])).toBe("a:b");
    });

    it("returns empty string for all falsy", () => {
      expect(storeKey([undefined, null, ""])).toBe("");
    });
  });

  describe("ensureEntry", () => {
    it("creates a new entry and meta", () => {
      const meta = ensureEntry("k1");

      expect(meta.key).toBe("k1");
      expect(meta.refs).toBeDefined();
      expect(meta.abort).toBeNull();
      expect(streamMetaMap.has("k1")).toBe(true);

      const storeEntry = useStreamStore.getState().entries["k1"];
      expect(storeEntry).toBeDefined();
      expect(storeEntry.isStreaming).toBe(false);
      expect(storeEntry.events).toEqual([]);
    });

    it("returns existing meta on second call", () => {
      const meta1 = ensureEntry("k1");
      const meta2 = ensureEntry("k1");
      expect(meta1).toBe(meta2);
    });

    it("updates lastAccessedAt on each call", () => {
      const meta = ensureEntry("k1");
      const firstAccess = meta.lastAccessedAt;

      ensureEntry("k1");
      expect(meta.lastAccessedAt).toBeGreaterThanOrEqual(firstAccess);
    });
  });

  describe("getStreamEntry", () => {
    it("returns undefined for missing key", () => {
      expect(getStreamEntry("missing")).toBeUndefined();
    });

    it("returns the entry state", () => {
      ensureEntry("k1");
      const entry = getStreamEntry("k1");
      expect(entry).toBeDefined();
      expect(entry!.isStreaming).toBe(false);
    });
  });

  describe("getIsStreaming", () => {
    it("returns false for missing key", () => {
      expect(getIsStreaming("nope")).toBe(false);
    });

    it("returns current streaming state", () => {
      ensureEntry("k1");
      expect(getIsStreaming("k1")).toBe(false);

      useStreamStore.setState((s) => ({
        entries: {
          ...s.entries,
          k1: { ...s.entries.k1, isStreaming: true },
        },
      }));

      expect(getIsStreaming("k1")).toBe(true);
    });
  });

  describe("getThinkingDurationMs", () => {
    it("returns null for missing key", () => {
      expect(getThinkingDurationMs("nope")).toBeNull();
    });

    it("returns the thinking duration", () => {
      ensureEntry("k1");
      useStreamStore.setState((s) => ({
        entries: {
          ...s.entries,
          k1: { ...s.entries.k1, thinkingDurationMs: 5000 },
        },
      }));

      expect(getThinkingDurationMs("k1")).toBe(5000);
    });
  });

  describe("resolve", () => {
    it("returns value directly for non-function", () => {
      expect(resolve("hello", "old")).toBe("hello");
    });

    it("calls function with prev value", () => {
      expect(resolve((prev: number) => prev + 1, 5)).toBe(6);
    });
  });

  describe("createSetters", () => {
    it("creates all setter functions", () => {
      ensureEntry("k1");
      const setters = createSetters("k1");

      expect(typeof setters.setStreamingText).toBe("function");
      expect(typeof setters.setThinkingText).toBe("function");
      expect(typeof setters.setThinkingDurationMs).toBe("function");
      expect(typeof setters.setActiveToolCalls).toBe("function");
      expect(typeof setters.setEvents).toBe("function");
      expect(typeof setters.setIsStreaming).toBe("function");
      expect(typeof setters.setProgressText).toBe("function");
      expect(typeof setters.setTimeline).toBe("function");
    });

    it("setIsStreaming updates store", () => {
      ensureEntry("k1");
      const setters = createSetters("k1");

      setters.setIsStreaming(true);
      expect(getIsStreaming("k1")).toBe(true);

      setters.setIsStreaming(false);
      expect(getIsStreaming("k1")).toBe(false);
    });

    it("setEvents updates store", () => {
      ensureEntry("k1");
      const setters = createSetters("k1");

      setters.setEvents([{ id: "m1", role: "user", content: "hello" }]);
      expect(getStreamEntry("k1")!.events).toHaveLength(1);
    });

    it("setEvents with function updater", () => {
      ensureEntry("k1");
      const setters = createSetters("k1");

      setters.setEvents([{ id: "m1", role: "user", content: "hello" }]);
      setters.setEvents((prev) => [
        ...prev,
        { id: "m2", role: "assistant", content: "hi" },
      ]);

      expect(getStreamEntry("k1")!.events).toHaveLength(2);
    });

    it("setStreamingText updates store", () => {
      ensureEntry("k1");
      const setters = createSetters("k1");

      setters.setStreamingText("streaming...");
      expect(getStreamEntry("k1")!.streamingText).toBe("streaming...");
    });

    it("setProgressText updates store", () => {
      ensureEntry("k1");
      const setters = createSetters("k1");

      setters.setProgressText("loading");
      expect(getStreamEntry("k1")!.progressText).toBe("loading");
    });
  });

  describe("pruneStreamStore", () => {
    it("does nothing when entries are fresh", () => {
      ensureEntry("k1");
      ensureEntry("k2");

      pruneStreamStore("k1");

      expect(streamMetaMap.has("k1")).toBe(true);
      expect(streamMetaMap.has("k2")).toBe(true);
    });

    it("preserves the preserveKey", () => {
      ensureEntry("k1");
      const meta = streamMetaMap.get("k1")!;
      meta.lastAccessedAt = 0;

      pruneStreamStore("k1");

      expect(streamMetaMap.has("k1")).toBe(true);
    });

    it("preserves entries that are actively streaming", () => {
      ensureEntry("k1");
      const meta = streamMetaMap.get("k1")!;
      meta.lastAccessedAt = 0;

      useStreamStore.setState((s) => ({
        entries: { ...s.entries, k1: { ...s.entries.k1, isStreaming: true } },
      }));

      pruneStreamStore();

      expect(streamMetaMap.has("k1")).toBe(true);
    });

    it("protects finalized entries with events from idle eviction", () => {
      ensureEntry("task:finalized");
      useStreamStore.setState((s) => ({
        entries: {
          ...s.entries,
          "task:finalized": {
            ...s.entries["task:finalized"],
            events: [makeEvent("e1", "done")],
          },
        },
      }));
      const meta = streamMetaMap.get("task:finalized");
      if (meta) meta.lastAccessedAt = Date.now() - 10 * 60 * 1000;

      pruneStreamStore();

      expect(getStreamEntry("task:finalized")).toBeDefined();
    });

    it("still evicts idle entries that never captured any events", () => {
      ensureEntry("task:empty");
      const meta = streamMetaMap.get("task:empty");
      if (meta) meta.lastAccessedAt = Date.now() - 10 * 60 * 1000;

      pruneStreamStore();

      expect(getStreamEntry("task:empty")).toBeUndefined();
    });
  });

  describe("seedStreamEventsFromCache", () => {
    it("populates an empty entry with the cached events", () => {
      seedStreamEventsFromCache("task:1", [makeEvent("e1", "hi")]);
      const entry = getStreamEntry("task:1");
      expect(entry?.events).toHaveLength(1);
      expect(entry?.events[0].content).toBe("hi");
    });

    it("does not clobber an entry that already has events", () => {
      ensureEntry("task:1");
      useStreamStore.setState((s) => ({
        entries: {
          ...s.entries,
          "task:1": {
            ...s.entries["task:1"],
            events: [makeEvent("live-1", "live")],
          },
        },
      }));
      seedStreamEventsFromCache("task:1", [makeEvent("cached-1", "cached")]);
      const entry = getStreamEntry("task:1");
      expect(entry?.events).toHaveLength(1);
      expect(entry?.events[0].id).toBe("live-1");
    });

    it("ignores seeding while the entry is actively streaming", () => {
      ensureEntry("task:1");
      useStreamStore.setState((s) => ({
        entries: {
          ...s.entries,
          "task:1": { ...s.entries["task:1"], isStreaming: true },
        },
      }));
      seedStreamEventsFromCache("task:1", [makeEvent("cached-1", "cached")]);
      const entry = getStreamEntry("task:1");
      expect(entry?.events).toHaveLength(0);
    });

    it("no-ops for empty event arrays", () => {
      seedStreamEventsFromCache("task:1", []);
      expect(getStreamEntry("task:1")).toBeUndefined();
    });
  });

  describe("acquireSharedStreamSubscriptions", () => {
    it("registers the subscription set exactly once for concurrent acquires", () => {
      const register = vi.fn(() => [vi.fn(), vi.fn()]);

      const release1 = acquireSharedStreamSubscriptions("task:t1", register);
      const release2 = acquireSharedStreamSubscriptions("task:t1", register);
      const release3 = acquireSharedStreamSubscriptions("task:t1", register);

      expect(register).toHaveBeenCalledTimes(1);
      expect(peekSharedSubscriptionRefCount("task:t1")).toBe(3);

      release1();
      release2();
      expect(peekSharedSubscriptionRefCount("task:t1")).toBe(1);

      release3();
      expect(peekSharedSubscriptionRefCount("task:t1")).toBe(0);
    });

    it("runs all disposers only when the last consumer releases", () => {
      const dispose1 = vi.fn();
      const dispose2 = vi.fn();
      const register = vi.fn(() => [dispose1, dispose2]);

      const releaseA = acquireSharedStreamSubscriptions("task:t1", register);
      const releaseB = acquireSharedStreamSubscriptions("task:t1", register);

      releaseA();
      expect(dispose1).not.toHaveBeenCalled();
      expect(dispose2).not.toHaveBeenCalled();

      releaseB();
      expect(dispose1).toHaveBeenCalledTimes(1);
      expect(dispose2).toHaveBeenCalledTimes(1);
    });

    it("re-runs register after the refcount drops to zero", () => {
      const register = vi.fn(() => [vi.fn()]);

      const release1 = acquireSharedStreamSubscriptions("task:t1", register);
      release1();
      expect(register).toHaveBeenCalledTimes(1);

      const release2 = acquireSharedStreamSubscriptions("task:t1", register);
      expect(register).toHaveBeenCalledTimes(2);
      release2();
    });

    it("makes release idempotent so double-calls do not underflow the refcount", () => {
      const register = vi.fn(() => [vi.fn()]);

      const release = acquireSharedStreamSubscriptions("task:t1", register);
      const extra = acquireSharedStreamSubscriptions("task:t1", register);
      expect(peekSharedSubscriptionRefCount("task:t1")).toBe(2);

      release();
      release();
      expect(peekSharedSubscriptionRefCount("task:t1")).toBe(1);

      extra();
      expect(peekSharedSubscriptionRefCount("task:t1")).toBe(0);
    });

    it("keys subscriptions independently so unrelated streams do not interfere", () => {
      const registerA = vi.fn(() => [vi.fn()]);
      const registerB = vi.fn(() => [vi.fn()]);

      const releaseA = acquireSharedStreamSubscriptions("task:a", registerA);
      const releaseB = acquireSharedStreamSubscriptions("task:b", registerB);
      expect(registerA).toHaveBeenCalledTimes(1);
      expect(registerB).toHaveBeenCalledTimes(1);

      releaseA();
      expect(peekSharedSubscriptionRefCount("task:a")).toBe(0);
      expect(peekSharedSubscriptionRefCount("task:b")).toBe(1);

      releaseB();
    });

    it("swallows disposer errors so later disposers still run", () => {
      const dispose1 = vi.fn(() => {
        throw new Error("boom");
      });
      const dispose2 = vi.fn();

      const release = acquireSharedStreamSubscriptions("task:t1", () => [
        dispose1,
        dispose2,
      ]);

      expect(() => release()).not.toThrow();
      expect(dispose1).toHaveBeenCalledTimes(1);
      expect(dispose2).toHaveBeenCalledTimes(1);
    });
  });
});
