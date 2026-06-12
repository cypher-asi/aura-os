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

    it("stamps a startMs on each new segment", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleThinkingDelta(refs, setters, "first ");
      handleToolCallStarted(refs, setters, { id: "tc1", name: "run" });
      handleThinkingDelta(refs, setters, "second");

      const thinkingItems = refs.timeline.current.filter(
        (t) => t.kind === "thinking",
      ) as Array<{ startMs?: number }>;
      expect(thinkingItems[0].startMs).toEqual(expect.any(Number));
      expect(thinkingItems[1].startMs).toEqual(expect.any(Number));
    });

    it("closes the prior thinking segment with its own durationMs when a tool starts", () => {
      // This is the screenshot scenario: thinking -> tool -> thinking ->
      // text must yield TWO distinct per-segment durations, not the
      // same turn-level total stamped on both blocks.
      const refs = makeRefs();
      const setters = makeSetters();

      handleThinkingDelta(refs, setters, "first ");
      vi.advanceTimersByTime(300);
      handleToolCallStarted(refs, setters, { id: "tc1", name: "run" });
      vi.advanceTimersByTime(50);
      handleThinkingDelta(refs, setters, "second");
      vi.advanceTimersByTime(700);
      handleTextDelta(refs, setters, null, "done");

      const thinkingItems = refs.timeline.current.filter(
        (t) => t.kind === "thinking",
      ) as Array<{ durationMs?: number }>;
      expect(thinkingItems).toHaveLength(2);
      expect(thinkingItems[0].durationMs).toBeGreaterThanOrEqual(300);
      expect(thinkingItems[0].durationMs).toBeLessThan(700);
      expect(thinkingItems[1].durationMs).toBeGreaterThanOrEqual(700);
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

    describe("frame-driven reveal pacing", () => {
      // The reveal runs as one rAF loop with AT MOST one store update
      // per frame. These tests replace the synchronous rAF shim with a
      // manual frame queue so each runFrame() models one display frame.
      let rafQueue: FrameRequestCallback[] = [];

      function useManualFrames() {
        rafQueue = [];
        globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
          rafQueue.push(cb);
          return nextRafId++;
        };
      }

      function runFrame() {
        const queue = rafQueue;
        rafQueue = [];
        for (const cb of queue) cb(0);
      }

      function lastText(setters: ReturnType<typeof makeSetters>): string | undefined {
        const writes = setters.calls.setStreamingText;
        return writes ? (writes[writes.length - 1] as string) : undefined;
      }

      it("publishes nothing until a frame runs, then reveals a word-snapped batch", () => {
        useManualFrames();
        const refs = makeRefs();
        const setters = makeSetters();

        handleTextDelta(refs, setters, null, "alpha beta gamma delta epsilon zeta eta theta");
        expect(setters.calls.setStreamingText).toBeUndefined();

        runFrame();
        const revealed = lastText(setters)!;
        expect(revealed.length).toBeGreaterThan(0);
        expect(revealed.length).toBeLessThan(refs.streamBuffer.current.length);
        // Word snapping: the visible slice never ends mid-word.
        expect(refs.streamBuffer.current[revealed.length] ?? " ").toMatch(/\s/);
        // Exactly one batched store update per frame.
        expect(setters.calls.applyStreamingPatch).toHaveLength(1);
      });

      it("keeps revealing one batch per frame until the buffer drains", () => {
        useManualFrames();
        const refs = makeRefs();
        const setters = makeSetters();
        const text =
          "one two three four five six seven eight nine ten eleven twelve " +
          "thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty";

        handleTextDelta(refs, setters, null, text);

        let guard = 0;
        while (refs.displayedTextLength.current < text.length && guard < 100) {
          runFrame();
          guard++;
        }
        expect(guard).toBeGreaterThan(1);
        expect(lastText(setters)).toBe(text);
      });

      it("scales the per-frame budget with the hidden backlog", () => {
        useManualFrames();
        const smallRefs = makeRefs();
        const smallSetters = makeSetters();
        handleTextDelta(smallRefs, smallSetters, null, "tiny backlog of words here");
        runFrame();
        const smallRevealed = lastText(smallSetters)!.length;

        useManualFrames();
        const bigRefs = makeRefs();
        const bigSetters = makeSetters();
        handleTextDelta(bigRefs, bigSetters, null, "word ".repeat(800).trim());
        runFrame();
        const bigRevealed = lastText(bigSetters)!.length;

        expect(bigRevealed).toBeGreaterThan(smallRevealed);
      });

      it("skips the animation entirely for very large backlogs", () => {
        useManualFrames();
        const refs = makeRefs();
        const setters = makeSetters();
        const text = "x".repeat(7000);

        handleTextDelta(refs, setters, null, text);
        runFrame();

        expect(refs.displayedTextLength.current).toBe(text.length);
        expect(lastText(setters)).toBe(text);
      });

      it("keeps punctuation and markdown prefixes attached to the revealed word", () => {
        useManualFrames();
        const refs = makeRefs();
        const setters = makeSetters();

        handleTextDelta(refs, setters, null, "Hello,\n- bullet item");

        let guard = 0;
        while (refs.displayedTextLength.current < refs.streamBuffer.current.length && guard < 100) {
          runFrame();
          guard++;
        }

        // No intermediate publish may end in a bare list marker or a
        // split word — every slice ends on a word boundary.
        for (const write of setters.calls.setStreamingText ?? []) {
          const slice = write as string;
          expect(slice).not.toMatch(/(^|\n)[-*+]\s*$/);
          const nextChar = refs.streamBuffer.current[slice.length];
          if (nextChar !== undefined) {
            expect(nextChar).toMatch(/\s/);
          }
        }
        expect(lastText(setters)).toBe("Hello,\n- bullet item");
      });
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
