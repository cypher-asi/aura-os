vi.mock("../../api/client", () => ({
  isInsufficientCreditsError: vi.fn(() => false),
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
  handleThinkingDelta,
  handleTextDelta,
  handleToolCallStarted,
  handleToolCall,
  handleToolResult,
  handleStreamError,
  finalizeStream,
} from "./handlers";
import type { StreamRefs, StreamSetters, ToolCallEntry } from "../../types/stream";

function makeRefs(): StreamRefs {
  return {
    streamBuffer: { current: "" },
    thinkingBuffer: { current: "" },
    thinkingStart: { current: null },
    toolCalls: { current: [] },
    needsSeparator: { current: false },
    raf: { current: null },
    thinkingRaf: { current: null },
    timeline: { current: [] },
  };
}

function makeSetters(): StreamSetters & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {};
  function track(name: string) {
    return (v: unknown) => {
      if (!calls[name]) calls[name] = [];
      calls[name].push(v);
    };
  }
  return {
    setStreamingText: track("setStreamingText") as StreamSetters["setStreamingText"],
    setThinkingText: track("setThinkingText") as StreamSetters["setThinkingText"],
    setThinkingDurationMs: track("setThinkingDurationMs") as StreamSetters["setThinkingDurationMs"],
    setActiveToolCalls: track("setActiveToolCalls") as StreamSetters["setActiveToolCalls"],
    setMessages: track("setMessages") as StreamSetters["setMessages"],
    setIsStreaming: track("setIsStreaming") as StreamSetters["setIsStreaming"],
    setProgressText: track("setProgressText") as StreamSetters["setProgressText"],
    setTimeline: track("setTimeline") as StreamSetters["setTimeline"],
    calls,
  };
}

describe("stream/handlers", () => {
  let origRAF: typeof requestAnimationFrame;

  beforeEach(() => {
    origRAF = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = origRAF;
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
  });

  describe("handleTextDelta", () => {
    it("appends to stream buffer", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleTextDelta(refs, setters, null, "hello ");
      handleTextDelta(refs, setters, null, "world");

      expect(refs.streamBuffer.current).toBe("hello world");
    });

    it("adds separator when needsSeparator is true", () => {
      const refs = makeRefs();
      refs.streamBuffer.current = "existing";
      refs.needsSeparator.current = true;
      const setters = makeSetters();

      handleTextDelta(refs, setters, null, " more");

      expect(refs.streamBuffer.current).toBe("existing\n\n more");
      expect(refs.needsSeparator.current).toBe(false);
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
  });

  describe("handleToolCallStarted", () => {
    it("adds a pending tool call entry", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleToolCallStarted(refs, setters, { id: "tc1", name: "create_spec" });

      expect(refs.toolCalls.current).toHaveLength(1);
      expect(refs.toolCalls.current[0].pending).toBe(true);
      expect(refs.toolCalls.current[0].started).toBe(true);
    });

    it("adds a tool timeline item", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleToolCallStarted(refs, setters, { id: "tc1", name: "create_spec" });

      expect(refs.timeline.current).toHaveLength(1);
      expect(refs.timeline.current[0]).toMatchObject({ kind: "tool", toolCallId: "tc1" });
    });
  });

  describe("handleToolCall", () => {
    it("creates new tool call entry when no started entry exists", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleToolCall(refs, setters, { id: "tc1", name: "run", input: { cmd: "ls" } });

      expect(refs.toolCalls.current).toHaveLength(1);
      expect(refs.toolCalls.current[0].input).toEqual({ cmd: "ls" });
    });

    it("updates existing started entry", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleToolCallStarted(refs, setters, { id: "tc1", name: "run" });
      handleToolCall(refs, setters, { id: "tc1", name: "run", input: { cmd: "ls" } });

      expect(refs.toolCalls.current).toHaveLength(1);
      expect(refs.toolCalls.current[0].input).toEqual({ cmd: "ls" });
      expect(refs.toolCalls.current[0].started).toBe(false);
    });
  });

  describe("handleToolResult", () => {
    it("marks tool call as resolved", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleToolCall(refs, setters, { id: "tc1", name: "run", input: {} });
      handleToolResult(refs, setters, { id: "tc1", name: "run", result: "ok", is_error: false });

      expect(refs.toolCalls.current[0].pending).toBe(false);
      expect(refs.toolCalls.current[0].result).toBe("ok");
      expect(refs.toolCalls.current[0].isError).toBe(false);
    });

    it("sets needsSeparator", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleToolCall(refs, setters, { id: "tc1", name: "run", input: {} });
      handleToolResult(refs, setters, { id: "tc1", name: "run", result: "", is_error: false });

      expect(refs.needsSeparator.current).toBe(true);
    });
  });

  describe("handleStreamError", () => {
    it("adds error message to messages", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleStreamError(refs, setters, "something broke");

      const setMessagesCalls = setters.calls.setMessages;
      expect(setMessagesCalls).toBeDefined();
    });

    it("includes buffered content as prefix", () => {
      const refs = makeRefs();
      refs.streamBuffer.current = "partial response";
      const setters = makeSetters();

      handleStreamError(refs, setters, "connection lost");

      const lastCall = setters.calls.setMessages[setters.calls.setMessages.length - 1];
      const updater = lastCall as (prev: unknown[]) => unknown[];
      const result = updater([]) as Array<{ content: string }>;
      expect(result[0].content).toContain("partial response");
      expect(result[0].content).toContain("connection lost");
    });
  });

  describe("finalizeStream", () => {
    it("saves buffered content as message when not streaming", () => {
      const refs = makeRefs();
      refs.streamBuffer.current = "final content";
      const setters = makeSetters();
      const abortRef = { current: null as AbortController | null };

      finalizeStream(refs, setters, abortRef, false);

      expect(setters.calls.setMessages).toBeDefined();
      expect(setters.calls.setIsStreaming).toBeDefined();
    });

    it("clears thinking state", () => {
      const refs = makeRefs();
      refs.thinkingBuffer.current = "thinking";
      refs.thinkingStart.current = Date.now();
      const setters = makeSetters();
      const abortRef = { current: null as AbortController | null };

      finalizeStream(refs, setters, abortRef, false);

      expect(refs.thinkingBuffer.current).toBe("");
      expect(refs.thinkingStart.current).toBeNull();
    });

    it("sets abortRef to null", () => {
      const refs = makeRefs();
      const setters = makeSetters();
      const controller = new AbortController();
      const abortRef = { current: controller as AbortController | null };

      finalizeStream(refs, setters, abortRef, false);

      expect(abortRef.current).toBeNull();
    });

    it("does not add message when buffer is empty", () => {
      const refs = makeRefs();
      const setters = makeSetters();
      const abortRef = { current: null as AbortController | null };

      finalizeStream(refs, setters, abortRef, false);

      const msgCalls = setters.calls.setMessages;
      expect(msgCalls).toBeUndefined();
    });
  });
});
