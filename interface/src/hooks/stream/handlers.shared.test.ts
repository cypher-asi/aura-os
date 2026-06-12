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
  snapshotThinking,
  snapshotToolCalls,
  snapshotTimeline,
  resetStreamBuffers,
} from "./handlers";
import {
  closeCurrentThinkingSegment,
  syncDisplayedTimeline,
  flushStreamingText,
} from "./handlers/shared";
import type { TimelineItem, ToolCallEntry } from "../../shared/types/stream";
import { makeRefs, makeSetters } from "./handlers.test-helpers";

describe("stream/handlers — shared snapshots and reset", () => {
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

  describe("snapshotThinking", () => {
    it("returns undefined when no thinking", () => {
      const refs = makeRefs();
      const snap = snapshotThinking(refs);
      expect(snap.savedThinking).toBeUndefined();
      expect(snap.savedThinkingDuration).toBeNull();
    });

    it("returns thinking text and duration", () => {
      const refs = makeRefs();
      refs.thinkingBuffer.current = "thinking...";
      refs.thinkingStart.current = Date.now() - 1000;

      const snap = snapshotThinking(refs);
      expect(snap.savedThinking).toBe("thinking...");
      expect(snap.savedThinkingDuration).toBeGreaterThanOrEqual(900);
    });
  });

  describe("snapshotToolCalls", () => {
    it("returns undefined when no tool calls", () => {
      const refs = makeRefs();
      expect(snapshotToolCalls(refs)).toBeUndefined();
    });

    it("returns a copy of tool calls", () => {
      const refs = makeRefs();
      const tc: ToolCallEntry = { id: "tc1", name: "test", input: {}, pending: false };
      refs.toolCalls.current = [tc];

      const snap = snapshotToolCalls(refs)!;
      expect(snap).toHaveLength(1);
      expect(snap[0].id).toBe("tc1");
      expect(snap).not.toBe(refs.toolCalls.current);
    });
  });

  describe("snapshotTimeline", () => {
    it("returns undefined when empty", () => {
      const refs = makeRefs();
      expect(snapshotTimeline(refs)).toBeUndefined();
    });

    it("returns a copy of timeline", () => {
      const refs = makeRefs();
      refs.timeline.current = [{ kind: "thinking", id: "t1" }];

      const snap = snapshotTimeline(refs)!;
      expect(snap).toHaveLength(1);
      expect(snap).not.toBe(refs.timeline.current);
    });
  });

  describe("closeCurrentThinkingSegment", () => {
    it("no-ops when the timeline is empty", () => {
      const refs = makeRefs();
      closeCurrentThinkingSegment(refs);
      expect(refs.timeline.current).toEqual([]);
    });

    it("no-ops when the last item is not a thinking segment", () => {
      const refs = makeRefs();
      refs.timeline.current = [{ kind: "tool", toolCallId: "tc1", id: "tl-1" }];
      closeCurrentThinkingSegment(refs);
      expect(refs.timeline.current).toEqual([
        { kind: "tool", toolCallId: "tc1", id: "tl-1" },
      ]);
    });

    it("stamps durationMs on the trailing thinking segment", () => {
      const refs = makeRefs();
      const start = Date.now();
      refs.timeline.current = [
        { kind: "thinking", id: "tl-1", text: "a", startMs: start },
      ];
      vi.advanceTimersByTime(500);
      closeCurrentThinkingSegment(refs);
      const last = refs.timeline.current[0];
      expect(last.kind).toBe("thinking");
      expect((last as { durationMs?: number }).durationMs).toBeGreaterThanOrEqual(
        500,
      );
    });

    it("is idempotent — a second call does not overwrite durationMs", () => {
      const refs = makeRefs();
      refs.timeline.current = [
        { kind: "thinking", id: "tl-1", text: "a", startMs: Date.now() },
      ];
      vi.advanceTimersByTime(200);
      closeCurrentThinkingSegment(refs);
      const first = (refs.timeline.current[0] as { durationMs?: number })
        .durationMs;
      vi.advanceTimersByTime(500);
      closeCurrentThinkingSegment(refs);
      const second = (refs.timeline.current[0] as { durationMs?: number })
        .durationMs;
      expect(second).toBe(first);
    });

    it("only closes the last thinking segment, not earlier ones", () => {
      // If a tool already sits between an older thinking item and the
      // current one, the older item was closed when that tool started;
      // closing now must not re-stamp it.
      const refs = makeRefs();
      const oldStart = Date.now();
      refs.timeline.current = [
        {
          kind: "thinking",
          id: "tl-1",
          text: "old",
          startMs: oldStart,
          durationMs: 123,
        },
        { kind: "tool", toolCallId: "tc1", id: "tl-2" },
        {
          kind: "thinking",
          id: "tl-3",
          text: "new",
          startMs: Date.now(),
        },
      ];
      vi.advanceTimersByTime(400);
      closeCurrentThinkingSegment(refs);
      expect(
        (refs.timeline.current[0] as { durationMs?: number }).durationMs,
      ).toBe(123);
      expect(
        (refs.timeline.current[2] as { durationMs?: number }).durationMs,
      ).toBeGreaterThanOrEqual(400);
    });

    it("ignores items missing startMs (hydrated history rows)", () => {
      const refs = makeRefs();
      refs.timeline.current = [
        { kind: "thinking", id: "tl-1", text: "hydrated" },
      ];
      closeCurrentThinkingSegment(refs);
      expect(
        (refs.timeline.current[0] as { durationMs?: number }).durationMs,
      ).toBeUndefined();
    });
  });

  describe("resetStreamBuffers", () => {
    it("clears all refs and calls all setters", () => {
      const refs = makeRefs();
      refs.streamBuffer.current = "text";
      refs.thinkingBuffer.current = "thinking";
      refs.thinkingStart.current = Date.now();
      refs.toolCalls.current = [{ id: "tc", name: "n", input: {}, pending: true }];
      refs.timeline.current = [{ kind: "thinking", id: "t1" }];

      const setters = makeSetters();
      resetStreamBuffers(refs, setters);

      expect(refs.streamBuffer.current).toBe("");
      expect(refs.thinkingBuffer.current).toBe("");
      expect(refs.thinkingStart.current).toBeNull();
      expect(refs.toolCalls.current).toEqual([]);
      expect(refs.timeline.current).toEqual([]);
      expect(setters.calls.setStreamingText).toBeDefined();
      expect(setters.calls.setThinkingText).toBeDefined();
    });
  });

  describe("syncDisplayedTimeline — text/tool ordering", () => {
    function lastPublishedTimeline(
      setters: ReturnType<typeof makeSetters>,
    ): TimelineItem[] {
      const writes = setters.calls.setTimeline;
      expect(writes).toBeDefined();
      expect(writes!.length).toBeGreaterThan(0);
      return writes![writes!.length - 1] as TimelineItem[];
    }

    it("holds back trailing tool cards until the preceding text finishes revealing", () => {
      // Strict ordering: a tool that sits *below* a still-typing
      // paragraph must not render before that paragraph has fully
      // revealed. The tool that sits *above* the paragraph (with no
      // unrevealed text before it) still renders normally.
      const refs = makeRefs();
      const setters = makeSetters();

      refs.streamBuffer.current = "hello world";
      refs.displayedTextLength.current = 3;
      refs.timeline.current = [
        { kind: "tool", toolCallId: "a", id: "tl-1" },
        { kind: "text", content: "hello world", id: "tl-2" },
        { kind: "tool", toolCallId: "b", id: "tl-3" },
      ];

      syncDisplayedTimeline(refs, setters);

      expect(lastPublishedTimeline(setters)).toEqual([
        { kind: "tool", toolCallId: "a", id: "tl-1" },
        { kind: "text", content: "hel", id: "tl-2" },
      ]);
    });

    it("keeps a tool above a still-typing later paragraph visible (no blink-out)", () => {
      // Rows above a fully-revealed paragraph stay stable even while a
      // later paragraph is mid-reveal — this is the case the old global
      // `textPending` flag got wrong by hiding the tool.
      const refs = makeRefs();
      const setters = makeSetters();

      refs.streamBuffer.current = "donelater";
      refs.displayedTextLength.current = 6;
      refs.timeline.current = [
        { kind: "text", content: "done", id: "tl-1" },
        { kind: "tool", toolCallId: "a", id: "tl-2" },
        { kind: "text", content: "later", id: "tl-3" },
      ];

      syncDisplayedTimeline(refs, setters);

      expect(lastPublishedTimeline(setters)).toEqual([
        { kind: "text", content: "done", id: "tl-1" },
        { kind: "tool", toolCallId: "a", id: "tl-2" },
        { kind: "text", content: "la", id: "tl-3" },
      ]);
    });

    it("publishes the full timeline once flushStreamingText reveals the buffer", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      refs.streamBuffer.current = "hello world";
      refs.displayedTextLength.current = 3;
      refs.timeline.current = [
        { kind: "tool", toolCallId: "a", id: "tl-1" },
        { kind: "text", content: "hello world", id: "tl-2" },
        { kind: "tool", toolCallId: "b", id: "tl-3" },
      ];

      flushStreamingText(refs, setters);

      expect(lastPublishedTimeline(setters)).toEqual([
        { kind: "tool", toolCallId: "a", id: "tl-1" },
        { kind: "text", content: "hello world", id: "tl-2" },
        { kind: "tool", toolCallId: "b", id: "tl-3" },
      ]);
    });

    it("stops at the first unrevealed text segment", () => {
      // Strict ordering: once the reveal cursor reaches a text segment
      // it has not finished (here the second segment "b"), nothing below
      // it renders — including the trailing tool. The row above the
      // unrevealed segment still shows because its text fully revealed.
      const refs = makeRefs();
      const setters = makeSetters();

      refs.streamBuffer.current = "ab";
      refs.displayedTextLength.current = 1;
      refs.timeline.current = [
        { kind: "text", content: "a", id: "tl-1" },
        { kind: "tool", toolCallId: "a", id: "tl-2" },
        { kind: "text", content: "b", id: "tl-3" },
        { kind: "tool", toolCallId: "b", id: "tl-4" },
      ];

      syncDisplayedTimeline(refs, setters);

      expect(lastPublishedTimeline(setters)).toEqual([
        { kind: "text", content: "a", id: "tl-1" },
        { kind: "tool", toolCallId: "a", id: "tl-2" },
      ]);
    });

    it("holds back a thinking card behind still-revealing text", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      refs.streamBuffer.current = "hello";
      refs.displayedTextLength.current = 2;
      refs.timeline.current = [
        { kind: "text", content: "hello", id: "tl-1" },
        { kind: "thinking", id: "tl-2", text: "later thought" },
      ];

      syncDisplayedTimeline(refs, setters);

      expect(lastPublishedTimeline(setters)).toEqual([
        { kind: "text", content: "he", id: "tl-1" },
      ]);
    });

    it("publishes trailing items immediately when there is no preceding text", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      refs.streamBuffer.current = "";
      refs.displayedTextLength.current = 0;
      refs.timeline.current = [
        { kind: "tool", toolCallId: "a", id: "tl-1" },
        { kind: "tool", toolCallId: "b", id: "tl-2" },
      ];

      syncDisplayedTimeline(refs, setters);

      expect(lastPublishedTimeline(setters)).toEqual([
        { kind: "tool", toolCallId: "a", id: "tl-1" },
        { kind: "tool", toolCallId: "b", id: "tl-2" },
      ]);
    });
  });
});
