vi.mock("../../api/client", () => ({
  isInsufficientCreditsError: vi.fn(() => false),
  isAgentBusyError: vi.fn(() => false),
  isHarnessCapacityExhaustedError: vi.fn(() => null),
  dispatchInsufficientCredits: vi.fn(),
}));

vi.mock("../../utils/chat-history", () => ({
  extractToolCalls: vi.fn(() => []),
  extractArtifactRefs: vi.fn(() => []),
}));

import {
  handleThinkingDelta,
  handleTextDelta,
  handleToolCallStarted,
  handleToolResult,
} from "./handlers";
import { makeRefs, makeSetters } from "./handlers.test-helpers";

describe("stream/handlers — thinking and text deltas", () => {
  let origRAF: typeof requestAnimationFrame;
  let nextRafId = 1;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    nextRafId = 1;
    origRAF = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return nextRafId++;
    };
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = origRAF;
    vi.useRealTimers();
  });

  describe("handleThinkingDelta", () => {
    it("appends to thinking buffer", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleThinkingDelta(refs, setters, "hello ");
      handleThinkingDelta(refs, setters, "world");

      expect(refs.thinkingBuffer.current).toBe("hello world");
    });

    it("sets thinking start time on first call", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleThinkingDelta(refs, setters, "hi");

      expect(refs.thinkingStart.current).not.toBeNull();
    });

    it("adds thinking timeline item on first call", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleThinkingDelta(refs, setters, "hi");

      expect(refs.timeline.current).toHaveLength(1);
      expect(refs.timeline.current[0].kind).toBe("thinking");
    });

    it("clears progress text", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleThinkingDelta(refs, setters, "hi");

      expect(setters.calls.setProgressText?.[0]).toBe("");
    });

    it("does not create a duplicate thinking segment for consecutive deltas", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleThinkingDelta(refs, setters, "hello ");
      handleThinkingDelta(refs, setters, "world");

      const thinkingItems = refs.timeline.current.filter(
        (t) => t.kind === "thinking",
      );
      expect(thinkingItems).toHaveLength(1);
      expect(thinkingItems[0]).toMatchObject({
        kind: "thinking",
        text: "hello world",
      });
    });

    it("tracks thinking text per segment when split by other timeline items", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleThinkingDelta(refs, setters, "first ");
      handleToolCallStarted(refs, setters, { id: "tc1", name: "run" });
      handleThinkingDelta(refs, setters, "second");

      const thinkingItems = refs.timeline.current.filter(
        (t) => t.kind === "thinking",
      );
      expect(thinkingItems).toHaveLength(2);
      expect(thinkingItems[0]).toMatchObject({ text: "first " });
      expect(thinkingItems[1]).toMatchObject({ text: "second" });
    });
  });

  describe("handleTextDelta", () => {
    it("appends to stream buffer", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleTextDelta(refs, setters, null, "hello ");
      handleTextDelta(refs, setters, null, "world");

      expect(refs.streamBuffer.current).toBe("hello world");
    });

    it("adds text timeline item", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleTextDelta(refs, setters, null, "hello");

      expect(refs.timeline.current).toHaveLength(1);
      expect(refs.timeline.current[0]).toMatchObject({ kind: "text", content: "hello" });
    });

    it("merges consecutive text items", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleTextDelta(refs, setters, null, "hello ");
      handleTextDelta(refs, setters, null, "world");

      expect(refs.timeline.current).toHaveLength(1);
    });

    it("reveals one word at a time", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleTextDelta(refs, setters, null, "hello world again");
      expect(setters.calls.setStreamingText).toBeUndefined();

      vi.advanceTimersByTime(15);
      expect(setters.calls.setStreamingText).toBeUndefined();

      vi.advanceTimersByTime(1);
      expect(setters.calls.setStreamingText).toEqual(["hello"]);
      expect(refs.displayedTextLength.current).toBe(5);
      expect(setters.calls.setTimeline?.[0]).toMatchObject([
        { kind: "text", content: "hello" },
      ]);

      vi.advanceTimersByTime(41);
      expect(setters.calls.setStreamingText).toEqual(["hello"]);

      vi.advanceTimersByTime(1);
      expect(setters.calls.setStreamingText).toEqual(["hello", "hello world"]);

      vi.advanceTimersByTime(42);
      expect(setters.calls.setStreamingText).toEqual([
        "hello",
        "hello world",
        "hello world again",
      ]);
    });

    it("accelerates reveal cadence when the hidden backlog grows", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleTextDelta(
        refs,
        setters,
        null,
        "one two three four five six seven eight nine ten eleven twelve thirteen",
      );

      vi.advanceTimersByTime(16);
      expect(setters.calls.setStreamingText).toEqual(["one"]);

      vi.advanceTimersByTime(11);
      expect(setters.calls.setStreamingText).toEqual(["one"]);

      vi.advanceTimersByTime(1);
      expect(setters.calls.setStreamingText).toEqual(["one", "one two"]);
    });

    it("keeps punctuation and markdown prefixes attached to the revealed word", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleTextDelta(refs, setters, null, "Hello,\n- bullet item");

      vi.advanceTimersByTime(16);
      expect(setters.calls.setStreamingText).toEqual(["Hello,"]);

      vi.advanceTimersByTime(42);
      expect(setters.calls.setStreamingText).toEqual(["Hello,", "Hello,\n- bullet"]);
    });

    it("keeps text strictly linear when tool calls interleave with prose", () => {
      // Arrival order `text -> tool -> tool -> text` must render in that
      // exact order. Text that arrives after a tool block goes into a NEW
      // text timeline item below the tools — it is NEVER folded back above
      // them. This is the invariant the linear-stream refactor enforces.
      const refs = makeRefs();
      const setters = makeSetters();

      handleTextDelta(refs, setters, null, "Issuing them");
      handleToolCallStarted(refs, setters, { id: "tc1", name: "run" });
      handleToolCallStarted(refs, setters, { id: "tc2", name: "run" });
      handleTextDelta(refs, setters, null, "tightly.");

      expect(refs.timeline.current).toHaveLength(4);
      expect(refs.timeline.current[0]).toMatchObject({
        kind: "text",
        content: "Issuing them",
      });
      expect(refs.timeline.current[1]).toMatchObject({ kind: "tool", toolCallId: "tc1" });
      expect(refs.timeline.current[2]).toMatchObject({ kind: "tool", toolCallId: "tc2" });
      expect(refs.timeline.current[3]).toMatchObject({
        kind: "text",
        content: "tightly.",
      });
      expect(refs.streamBuffer.current).toBe("Issuing themtightly.");
    });

    it("creates a fresh text item after a tool_result (no retroactive merge)", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleTextDelta(refs, setters, null, "before");
      handleToolCallStarted(refs, setters, { id: "tc1", name: "run" });
      handleToolResult(refs, setters, { id: "tc1", name: "run", result: "", is_error: false });
      handleTextDelta(refs, setters, null, "after");

      expect(refs.timeline.current).toHaveLength(3);
      expect(refs.timeline.current[0]).toMatchObject({ kind: "text", content: "before" });
      expect(refs.timeline.current[1]).toMatchObject({ kind: "tool", toolCallId: "tc1" });
      expect(refs.timeline.current[2]).toMatchObject({ kind: "text", content: "after" });
      expect(refs.streamBuffer.current).toBe("beforeafter");
    });
  });
});
