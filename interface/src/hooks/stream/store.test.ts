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
} from "./store";

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
  });
});
