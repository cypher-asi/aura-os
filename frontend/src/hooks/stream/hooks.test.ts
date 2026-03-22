import { renderHook } from "@testing-library/react";
import { useStreamStore, ensureEntry, streamMetaMap, createSetters } from "./store";
import {
  useStreamMessages,
  useIsStreaming,
  useStreamingText,
  useThinkingText,
  useThinkingDurationMs,
  useActiveToolCalls,
  useTimeline,
  useProgressText,
} from "./hooks";

describe("stream/hooks", () => {
  beforeEach(() => {
    streamMetaMap.clear();
    useStreamStore.setState({ entries: {} });
  });

  describe("useStreamMessages", () => {
    it("returns empty array for missing key", () => {
      const { result } = renderHook(() => useStreamMessages("missing"));
      expect(result.current).toEqual([]);
    });

    it("returns messages from the store", () => {
      ensureEntry("k1");
      const setters = createSetters("k1");
      setters.setMessages([{ id: "m1", role: "user", content: "hi" }]);

      const { result } = renderHook(() => useStreamMessages("k1"));
      expect(result.current).toHaveLength(1);
      expect(result.current[0].content).toBe("hi");
    });

    it("returns stable reference for missing key", () => {
      const { result, rerender } = renderHook(() =>
        useStreamMessages("missing"),
      );
      const first = result.current;
      rerender();
      expect(result.current).toBe(first);
    });
  });

  describe("useIsStreaming", () => {
    it("returns false for missing key", () => {
      const { result } = renderHook(() => useIsStreaming("missing"));
      expect(result.current).toBe(false);
    });

    it("reflects streaming state", () => {
      ensureEntry("k1");
      createSetters("k1").setIsStreaming(true);

      const { result } = renderHook(() => useIsStreaming("k1"));
      expect(result.current).toBe(true);
    });
  });

  describe("useStreamingText", () => {
    it("returns empty string for missing key", () => {
      const { result } = renderHook(() => useStreamingText("missing"));
      expect(result.current).toBe("");
    });

    it("returns streaming text from store", () => {
      ensureEntry("k1");
      createSetters("k1").setStreamingText("hello");

      const { result } = renderHook(() => useStreamingText("k1"));
      expect(result.current).toBe("hello");
    });
  });

  describe("useThinkingText", () => {
    it("returns empty string for missing key", () => {
      const { result } = renderHook(() => useThinkingText("missing"));
      expect(result.current).toBe("");
    });

    it("returns thinking text from store", () => {
      ensureEntry("k1");
      createSetters("k1").setThinkingText("reasoning...");

      const { result } = renderHook(() => useThinkingText("k1"));
      expect(result.current).toBe("reasoning...");
    });
  });

  describe("useThinkingDurationMs", () => {
    it("returns null for missing key", () => {
      const { result } = renderHook(() => useThinkingDurationMs("missing"));
      expect(result.current).toBeNull();
    });

    it("returns duration from store", () => {
      ensureEntry("k1");
      createSetters("k1").setThinkingDurationMs(3000);

      const { result } = renderHook(() => useThinkingDurationMs("k1"));
      expect(result.current).toBe(3000);
    });
  });

  describe("useActiveToolCalls", () => {
    it("returns empty array for missing key", () => {
      const { result } = renderHook(() => useActiveToolCalls("missing"));
      expect(result.current).toEqual([]);
    });

    it("returns stable empty reference", () => {
      const { result, rerender } = renderHook(() =>
        useActiveToolCalls("missing"),
      );
      const first = result.current;
      rerender();
      expect(result.current).toBe(first);
    });

    it("returns tool calls from store", () => {
      ensureEntry("k1");
      createSetters("k1").setActiveToolCalls([
        { id: "tc1", name: "test", input: {}, pending: true },
      ]);

      const { result } = renderHook(() => useActiveToolCalls("k1"));
      expect(result.current).toHaveLength(1);
      expect(result.current[0].name).toBe("test");
    });
  });

  describe("useTimeline", () => {
    it("returns empty array for missing key", () => {
      const { result } = renderHook(() => useTimeline("missing"));
      expect(result.current).toEqual([]);
    });

    it("returns timeline from store", () => {
      ensureEntry("k1");
      createSetters("k1").setTimeline([{ kind: "thinking", id: "t1" }]);

      const { result } = renderHook(() => useTimeline("k1"));
      expect(result.current).toHaveLength(1);
      expect(result.current[0].kind).toBe("thinking");
    });
  });

  describe("useProgressText", () => {
    it("returns empty string for missing key", () => {
      const { result } = renderHook(() => useProgressText("missing"));
      expect(result.current).toBe("");
    });

    it("returns progress text from store", () => {
      ensureEntry("k1");
      createSetters("k1").setProgressText("Loading context...");

      const { result } = renderHook(() => useProgressText("k1"));
      expect(result.current).toBe("Loading context...");
    });
  });
});
