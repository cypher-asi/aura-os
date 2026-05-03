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
import type { ToolCallEntry } from "../../shared/types/stream";
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
});
