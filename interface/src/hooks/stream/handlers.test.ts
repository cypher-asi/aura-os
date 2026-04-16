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
  handleToolCallSnapshot,
  handleToolCall,
  handleToolResult,
  handleStreamError,
  finalizeStream,
} from "./handlers";
import {
  dispatchInsufficientCredits,
  isInsufficientCreditsError,
} from "../../api/client";
import type { StreamRefs, StreamSetters, ToolCallEntry } from "../../types/stream";

function makeRefs(): StreamRefs {
  return {
    streamBuffer: { current: "" },
    thinkingBuffer: { current: "" },
    thinkingStart: { current: null },
    toolCalls: { current: [] },
    needsSeparator: { current: false },
    raf: { current: null },
    flushTimeout: { current: null },
    displayedTextLength: { current: 0 },
    lastTextFlushAt: { current: 0 },
    thinkingRaf: { current: null },
    timeline: { current: [] },
    snapshottedToolCallIds: { current: new Set() },
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
    setEvents: track("setEvents") as StreamSetters["setEvents"],
    setIsStreaming: track("setIsStreaming") as StreamSetters["setIsStreaming"],
    setProgressText: track("setProgressText") as StreamSetters["setProgressText"],
    setTimeline: track("setTimeline") as StreamSetters["setTimeline"],
    calls,
  };
}

describe("stream/handlers", () => {
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

    it("captures the streamed assistant draft as draft_preview for spec tools", () => {
      const refs = makeRefs();
      const setters = makeSetters();
      refs.streamBuffer.current = "# Draft spec\n\nBody text";
      refs.displayedTextLength.current = refs.streamBuffer.current.length;

      handleToolCallStarted(refs, setters, { id: "tc1", name: "create_spec" });

      expect(refs.toolCalls.current[0].input).toEqual({
        draft_preview: "# Draft spec\n\nBody text",
      });
    });

    it("flushes any pending streamed text before starting a spec tool", () => {
      const refs = makeRefs();
      const setters = makeSetters();
      refs.streamBuffer.current = "# Draft spec";
      refs.displayedTextLength.current = 0;

      handleToolCallStarted(refs, setters, { id: "tc1", name: "create_spec" });

      expect(setters.calls.setStreamingText).toContain("# Draft spec");
    });

    it("prefers current thinking text as the initial spec preview", () => {
      const refs = makeRefs();
      const setters = makeSetters();
      refs.thinkingBuffer.current = "Thinking draft";
      refs.streamBuffer.current = "Visible text draft";

      handleToolCallStarted(refs, setters, { id: "tc1", name: "create_spec" });

      expect(refs.toolCalls.current[0].input).toEqual({
        draft_preview: "Visible text draft",
      });
    });

    it("seeds empty path/content for write_file so the preview can render", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleToolCallStarted(refs, setters, { id: "tc1", name: "write_file" });

      expect(refs.toolCalls.current[0].input).toEqual({ path: "", content: "" });
    });

    it("seeds empty path/old_text/new_text for edit_file", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleToolCallStarted(refs, setters, { id: "tc1", name: "edit_file" });

      expect(refs.toolCalls.current[0].input).toEqual({
        path: "",
        old_text: "",
        new_text: "",
      });
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

  describe("handleToolCallSnapshot", () => {
    it("merges snapshot input into existing started entry by id", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleToolCallStarted(refs, setters, { id: "tc1", name: "create_spec" });
      handleToolCallSnapshot(refs, setters, {
        id: "tc1",
        name: "create_spec",
        input: { title: "Spec 1" },
      });

      expect(refs.toolCalls.current).toHaveLength(1);
      expect(refs.toolCalls.current[0]).toMatchObject({
        id: "tc1",
        name: "create_spec",
        started: true,
      });
      expect(refs.toolCalls.current[0].input).toEqual({ title: "Spec 1" });
      expect(setters.calls.setActiveToolCalls).toBeDefined();
    });

    it("supports incremental snapshot growth for create_spec markdown", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleToolCallStarted(refs, setters, { id: "tc1", name: "create_spec" });
      handleToolCallSnapshot(refs, setters, {
        id: "tc1",
        name: "create_spec",
        input: { title: "Spec 1", markdown_contents: "Hello" },
      });
      handleToolCallSnapshot(refs, setters, {
        id: "tc1",
        name: "create_spec",
        input: { markdown_contents: "Hello world" },
      });

      expect(refs.toolCalls.current).toHaveLength(1);
      expect(refs.toolCalls.current[0].input).toEqual({
        title: "Spec 1",
        markdown_contents: "Hello world",
      });
    });

    it("supports incremental snapshot growth for write_file content", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleToolCallStarted(refs, setters, { id: "tc1", name: "write_file" });
      handleToolCallSnapshot(refs, setters, {
        id: "tc1",
        name: "write_file",
        input: { path: "src/a.ts", content: "export const x" },
      });
      handleToolCallSnapshot(refs, setters, {
        id: "tc1",
        name: "write_file",
        input: { content: "export const x = 1;" },
      });

      expect(refs.toolCalls.current[0].input).toEqual({
        path: "src/a.ts",
        content: "export const x = 1;",
      });
    });

    it("supports incremental snapshot growth for edit_file new_text", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleToolCallStarted(refs, setters, { id: "tc1", name: "edit_file" });
      handleToolCallSnapshot(refs, setters, {
        id: "tc1",
        name: "edit_file",
        input: { path: "a.ts", old_text: "foo", new_text: "ba" },
      });
      handleToolCallSnapshot(refs, setters, {
        id: "tc1",
        name: "edit_file",
        input: { new_text: "bar" },
      });

      expect(refs.toolCalls.current[0].input).toEqual({
        path: "a.ts",
        old_text: "foo",
        new_text: "bar",
      });
    });

    it("creates a pending started entry when snapshot arrives before started event", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleToolCallSnapshot(refs, setters, {
        id: "tc2",
        name: "create_spec",
        input: { title: "Early snapshot" },
      });

      expect(refs.toolCalls.current).toHaveLength(1);
      expect(refs.toolCalls.current[0]).toMatchObject({
        id: "tc2",
        name: "create_spec",
        pending: true,
        started: true,
      });
      expect(refs.timeline.current).toHaveLength(1);
      expect(refs.timeline.current[0]).toMatchObject({ kind: "tool", toolCallId: "tc2" });
    });
  });

  describe("handleThinkingDelta", () => {
    it("does not seed pending spec previews from thinking text", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleToolCallStarted(refs, setters, { id: "tc1", name: "create_spec" });
      handleThinkingDelta(refs, setters, "# Draft");
      handleThinkingDelta(refs, setters, " spec body");

      expect(refs.toolCalls.current[0].input).toEqual({});
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

    it("resolves latest pending tool by name when id is missing", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleToolCall(refs, setters, { id: "tc1", name: "write_file", input: { path: "a.txt" } });
      handleToolCall(refs, setters, { id: "tc2", name: "write_file", input: { path: "b.txt" } });
      handleToolResult(refs, setters, { name: "write_file", result: "ok", is_error: false });

      expect(refs.toolCalls.current[0].pending).toBe(true);
      expect(refs.toolCalls.current[1].pending).toBe(false);
      expect(refs.toolCalls.current[1].result).toBe("ok");
    });
  });

  describe("handleStreamError", () => {
    it("adds error message to messages", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleStreamError(refs, setters, "something broke");

      const setEventsCalls = setters.calls.setEvents;
      expect(setEventsCalls).toBeDefined();
    });

    it("includes buffered content as prefix", () => {
      const refs = makeRefs();
      refs.streamBuffer.current = "partial response";
      const setters = makeSetters();

      handleStreamError(refs, setters, "connection lost");

      const lastCall = setters.calls.setEvents[setters.calls.setEvents.length - 1];
      const updater = lastCall as (prev: unknown[]) => unknown[];
      const result = updater([]) as Array<{ content: string }>;
      expect(result[0].content).toContain("partial response");
      expect(result[0].content).toContain("connection lost");
    });

    it("normalizes insufficient credits errors into a purchase prompt", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      vi.mocked(isInsufficientCreditsError).mockReturnValue(true);

      handleStreamError(refs, setters, new Error("billing server error"));

      expect(dispatchInsufficientCredits).toHaveBeenCalledOnce();

      const lastCall = setters.calls.setEvents[setters.calls.setEvents.length - 1];
      const updater = lastCall as (prev: unknown[]) => unknown[];
      const result = updater([]) as Array<{ content: string; displayVariant?: string }>;

      expect(result[0].content).toBe("You have no credits remaining. Buy more credits to continue.");
      expect(result[0].displayVariant).toBe("insufficientCreditsError");
    });
  });

  describe("finalizeStream", () => {
    it("saves buffered content as message when not streaming", () => {
      const refs = makeRefs();
      refs.streamBuffer.current = "final content";
      const setters = makeSetters();
      const abortRef = { current: null as AbortController | null };

      finalizeStream(refs, setters, abortRef, false);

      expect(setters.calls.setEvents).toBeDefined();
      expect(setters.calls.setIsStreaming).toBeDefined();
    });

    it("clears thinking state", () => {
      const refs = makeRefs();
      refs.streamBuffer.current = "content";
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

      const msgCalls = setters.calls.setEvents as Array<(prev: unknown[]) => unknown[]> | undefined;
      if (msgCalls) {
        const result = msgCalls[msgCalls.length - 1]([]);
        expect(result).toEqual([]);
      }
    });

    it("marks pending tools as successful on normal completion", () => {
      const refs = makeRefs();
      refs.toolCalls.current = [{ id: "tc-1", name: "write_file", input: {}, pending: true, started: true }];
      const setters = makeSetters();
      const abortRef = { current: null as AbortController | null };

      finalizeStream(refs, setters, abortRef, false, { reason: "completed" });

      expect(refs.toolCalls.current[0].pending).toBe(false);
      expect(refs.toolCalls.current[0].isError).toBe(false);
      expect(refs.toolCalls.current[0].result).toContain("Completed before an explicit tool result");
    });

    it("marks pending tools as failed with the provided message", () => {
      const refs = makeRefs();
      refs.toolCalls.current = [{ id: "tc-1", name: "write_file", input: {}, pending: true, started: true }];
      const setters = makeSetters();
      const abortRef = { current: null as AbortController | null };

      finalizeStream(refs, setters, abortRef, false, {
        reason: "failed",
        message: "Harness timed out",
      });

      expect(refs.toolCalls.current[0].pending).toBe(false);
      expect(refs.toolCalls.current[0].isError).toBe(true);
      expect(refs.toolCalls.current[0].result).toBe("Harness timed out");
    });

    it("saves the full buffered content even when only part of it was revealed", () => {
      const refs = makeRefs();
      const setters = makeSetters();
      const abortRef = { current: null as AbortController | null };

      handleTextDelta(refs, setters, null, "hello world again");
      vi.advanceTimersByTime(16);
      expect(setters.calls.setStreamingText).toEqual(["hello"]);

      finalizeStream(refs, setters, abortRef, false);

      const lastCall = setters.calls.setEvents[setters.calls.setEvents.length - 1];
      const updater = lastCall as (prev: unknown[]) => Array<{ content: string }>;
      const result = updater([]);

      expect(result[0].content).toBe("hello world again");
    });
  });
});
