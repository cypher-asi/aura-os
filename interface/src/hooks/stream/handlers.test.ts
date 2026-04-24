vi.mock("../../api/client", () => ({
  isInsufficientCreditsError: vi.fn(() => false),
  isAgentBusyError: vi.fn(() => false),
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
  handleToolCallRetrying,
  handleToolCallFailed,
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
    setIsWriting: track("setIsWriting") as StreamSetters["setIsWriting"],
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

    it("does not seed empty path/content for write_file so the Block renders its header only", () => {
      // Seeding empty strings previously caused FileBlock to show "..." as the
      // filename and render an empty code surface (just a "1" line number)
      // until the first snapshot arrived. The live path/content arrive via
      // ToolCallSnapshot, which then populates the block correctly.
      const refs = makeRefs();
      const setters = makeSetters();

      handleToolCallStarted(refs, setters, { id: "tc1", name: "write_file" });

      expect(refs.toolCalls.current[0].input).toEqual({});
    });

    it("does not seed empty fields for edit_file", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleToolCallStarted(refs, setters, { id: "tc1", name: "edit_file" });

      expect(refs.toolCalls.current[0].input).toEqual({});
    });

    it("is idempotent on info.id when delivered twice", () => {
      // Duplicate deliveries happen in practice when (a) a task/run is
      // rendered in two places and both mounts subscribe to the same WS
      // EventType, or (b) chat history replay overlaps with a live stream.
      // Either path used to push a second pending tool card and timeline
      // row into the shared streamKey refs.
      const refs = makeRefs();
      const setters = makeSetters();

      handleToolCallStarted(refs, setters, { id: "tc1", name: "run" });
      handleToolCallStarted(refs, setters, { id: "tc1", name: "run" });
      handleToolCallStarted(refs, setters, { id: "tc1", name: "run" });

      expect(refs.toolCalls.current).toHaveLength(1);
      expect(
        refs.timeline.current.filter(
          (item) => item.kind === "tool" && item.toolCallId === "tc1",
        ),
      ).toHaveLength(1);
    });

    it("re-flags an existing entry as started if it was first seen via a snapshot", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleToolCallSnapshot(refs, setters, {
        id: "tc1",
        name: "write_file",
        input: { path: "a.ts" },
      });
      expect(refs.toolCalls.current).toHaveLength(1);

      handleToolCallStarted(refs, setters, { id: "tc1", name: "write_file" });

      expect(refs.toolCalls.current).toHaveLength(1);
      expect(refs.toolCalls.current[0].started).toBe(true);
      expect(refs.toolCalls.current[0].input).toEqual({ path: "a.ts" });
      expect(
        refs.timeline.current.filter(
          (item) => item.kind === "tool" && item.toolCallId === "tc1",
        ),
      ).toHaveLength(1);
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

      // The resolved tool call is persisted into events and the ref is cleared
      // as part of the save. Inspect the persisted copy.
      const lastSetEvents = setters.calls.setEvents[
        setters.calls.setEvents.length - 1
      ] as (prev: unknown[]) => Array<{ toolCalls?: ToolCallEntry[] }>;
      const saved = lastSetEvents([])[0]?.toolCalls?.[0];
      expect(saved).toBeDefined();
      expect(saved?.pending).toBe(false);
      expect(saved?.isError).toBe(false);
      expect(saved?.result).toContain("Completed before an explicit tool result");
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

      const lastSetEvents = setters.calls.setEvents[
        setters.calls.setEvents.length - 1
      ] as (prev: unknown[]) => Array<{ toolCalls?: ToolCallEntry[] }>;
      const saved = lastSetEvents([])[0]?.toolCalls?.[0];
      expect(saved).toBeDefined();
      expect(saved?.pending).toBe(false);
      expect(saved?.isError).toBe(true);
      expect(saved?.result).toBe("Harness timed out");
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

    it("persists buffered turn on terminal reason even when closureIsStreaming=true", () => {
      // Task streams call finalizeStream with closureIsStreaming=true on
      // TaskCompleted. The buffered turn must still be saved, otherwise the
      // Sidekick run panel shows a bare header with no content.
      const refs = makeRefs();
      refs.streamBuffer.current = "partial summary";
      refs.toolCalls.current = [
        { id: "tc-1", name: "write_file", input: { path: "foo.md" }, pending: true, started: true },
      ];
      refs.timeline.current = [{ kind: "tool", toolCallId: "tc-1", id: 1 }];
      const setters = makeSetters();
      const abortRef = { current: null as AbortController | null };

      finalizeStream(refs, setters, abortRef, true, { reason: "completed" });

      const lastCall = setters.calls.setEvents[setters.calls.setEvents.length - 1];
      const updater = lastCall as (prev: unknown[]) => Array<{
        content: string;
        toolCalls?: ToolCallEntry[];
        timeline?: unknown[];
      }>;
      const result = updater([]);
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("partial summary");
      expect(result[0].toolCalls).toHaveLength(1);
      expect(result[0].toolCalls?.[0].id).toBe("tc-1");
      expect(result[0].timeline).toHaveLength(1);
      expect(refs.streamBuffer.current).toBe("");
      expect(refs.toolCalls.current).toEqual([]);
    });

    it("does not duplicate tool calls already snapshotted by a prior turn boundary", () => {
      // AssistantMessageEnd consolidates a turn via handleAssistantTurnBoundary
      // and marks the tool calls as snapshotted. A subsequent finalizeStream
      // on TaskCompleted must not re-save the same tool call.
      const refs = makeRefs();
      const snapshottedTool: ToolCallEntry = {
        id: "tc-already-saved",
        name: "read_file",
        input: { path: "a.md" },
        pending: false,
        started: true,
      };
      refs.toolCalls.current = [snapshottedTool];
      refs.snapshottedToolCallIds.current = new Set(["tc-already-saved"]);
      const setters = makeSetters();
      const abortRef = { current: null as AbortController | null };

      finalizeStream(refs, setters, abortRef, true, { reason: "completed" });

      const eventCalls =
        (setters.calls.setEvents as Array<(prev: unknown[]) => unknown[]> | undefined) ?? [];
      const mostRecent = eventCalls[eventCalls.length - 1]?.([]) ?? [];
      expect(mostRecent).toEqual([]);
    });

    it.skip("_retrying marker follows", () => {});
  });

  describe("handleToolCallRetrying", () => {
    it("flips the matching tool call into retrying state with attempt/max/reason", () => {
      const refs = makeRefs();
      const setters = makeSetters();
      handleToolCallStarted(refs, setters, { id: "tc-1", name: "write_file" });

      handleToolCallRetrying(refs, setters, {
        id: "tc-1",
        name: "write_file",
        attempt: 3,
        max_attempts: 8,
        delay_ms: 1000,
        reason: "upstream_529_overloaded",
      });

      const entry = refs.toolCalls.current[0];
      expect(entry.retrying).toBe(true);
      expect(entry.retryAttempt).toBe(3);
      expect(entry.retryMax).toBe(8);
      expect(entry.retryReason).toBe("upstream_529_overloaded");
      expect(entry.pending).toBe(true);
    });

    it("synthesizes a pending placeholder when the start event hasn't arrived yet", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleToolCallRetrying(refs, setters, {
        id: "tc-unknown",
        name: "edit_file",
        attempt: 1,
        max_attempts: 8,
        delay_ms: 250,
        reason: "stream_aborted_mid_tool_use",
      });

      expect(refs.toolCalls.current).toHaveLength(1);
      const entry = refs.toolCalls.current[0];
      expect(entry.id).toBe("tc-unknown");
      expect(entry.pending).toBe(true);
      expect(entry.retrying).toBe(true);
      expect(entry.retryAttempt).toBe(1);
      expect(entry.retryReason).toBe("stream_aborted_mid_tool_use");
      expect(
        refs.timeline.current.some(
          (item) => item.kind === "tool" && item.toolCallId === "tc-unknown",
        ),
      ).toBe(true);
    });

    it("is cleared by a subsequent ToolCallSnapshot but preserves attempt/max/reason", () => {
      const refs = makeRefs();
      const setters = makeSetters();
      handleToolCallStarted(refs, setters, { id: "tc-1", name: "write_file" });
      handleToolCallRetrying(refs, setters, {
        id: "tc-1",
        name: "write_file",
        attempt: 2,
        max_attempts: 8,
        delay_ms: 500,
        reason: "upstream_529_overloaded",
      });
      handleToolCallSnapshot(refs, setters, {
        id: "tc-1",
        name: "write_file",
        input: { path: "foo.ts", content: "..." },
      });

      const entry = refs.toolCalls.current[0];
      expect(entry.retrying).toBe(false);
      expect(entry.retryAttempt).toBe(2);
      expect(entry.retryMax).toBe(8);
      expect(entry.retryReason).toBe("upstream_529_overloaded");
      expect(entry.input.path).toBe("foo.ts");
    });

    it("is cleared when a successful ToolResult lands", () => {
      const refs = makeRefs();
      const setters = makeSetters();
      handleToolCallStarted(refs, setters, { id: "tc-1", name: "write_file" });
      handleToolCallRetrying(refs, setters, {
        id: "tc-1",
        name: "write_file",
        attempt: 2,
        max_attempts: 8,
        delay_ms: 500,
        reason: "upstream_529_overloaded",
      });
      handleToolResult(refs, setters, {
        id: "tc-1",
        name: "write_file",
        result: "ok",
        is_error: false,
      });

      const entry = refs.toolCalls.current[0];
      expect(entry.retrying).toBe(false);
      expect(entry.pending).toBe(false);
      expect(entry.isError).toBe(false);
    });
  });

  describe("handleToolCallFailed", () => {
    it("latches retryExhausted, marks the entry errored, and synthesizes a result", () => {
      const refs = makeRefs();
      const setters = makeSetters();
      handleToolCallStarted(refs, setters, { id: "tc-1", name: "write_file" });
      handleToolCallRetrying(refs, setters, {
        id: "tc-1",
        name: "write_file",
        attempt: 8,
        max_attempts: 8,
        delay_ms: 2000,
        reason: "upstream_529_overloaded",
      });

      handleToolCallFailed(refs, setters, {
        id: "tc-1",
        name: "write_file",
        reason: "upstream_529_overloaded",
      });

      const entry = refs.toolCalls.current[0];
      expect(entry.pending).toBe(false);
      expect(entry.isError).toBe(true);
      expect(entry.retrying).toBe(false);
      expect(entry.retryExhausted).toBe(true);
      expect(entry.retryReason).toBe("upstream_529_overloaded");
      expect(entry.result).toContain("Tool call failed after retries");
      expect(entry.result).toContain("upstream_529_overloaded");
    });

    it("updates already-saved events carrying the same tool_use_id", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleToolCallFailed(refs, setters, {
        id: "tc-saved",
        name: "edit_file",
        reason: "stream_aborted_mid_tool_use",
      });

      const eventsCalls =
        (setters.calls.setEvents as Array<(prev: unknown[]) => unknown[]> | undefined) ?? [];
      expect(eventsCalls).not.toHaveLength(0);
      const updater = eventsCalls[eventsCalls.length - 1];
      const prev: Array<{ toolCalls?: ToolCallEntry[] }> = [
        {
          toolCalls: [
            {
              id: "tc-saved",
              name: "edit_file",
              input: {},
              pending: true,
              started: true,
            } as ToolCallEntry,
          ],
        },
      ];
      const next = updater(prev) as typeof prev;
      const saved = next[0].toolCalls?.[0];
      expect(saved?.pending).toBe(false);
      expect(saved?.isError).toBe(true);
      expect(saved?.retryExhausted).toBe(true);
      expect(saved?.retryReason).toBe("stream_aborted_mid_tool_use");
      expect(saved?.result).toContain("Tool call failed after retries");
    });

    it("falls back to a generic reason when none is supplied", () => {
      const refs = makeRefs();
      const setters = makeSetters();
      handleToolCallStarted(refs, setters, { id: "tc-1", name: "write_file" });

      handleToolCallFailed(refs, setters, {
        id: "tc-1",
        name: "write_file",
        reason: "",
      });

      const entry = refs.toolCalls.current[0];
      expect(entry.result).toContain("upstream tool call failed");
      expect(entry.retryExhausted).toBe(true);
    });
  });

  describe("finalizeStream (continued)", () => {
    it("does not persist a mid-stream closure without a terminal reason", () => {
      // Chat streams can call finalize mid-turn; those keep their buffers so
      // the follow-up AssistantMessageEnd/onDone save the turn once.
      const refs = makeRefs();
      refs.streamBuffer.current = "mid-turn text";
      const setters = makeSetters();
      const abortRef = { current: null as AbortController | null };

      finalizeStream(refs, setters, abortRef, true);

      const eventCalls =
        (setters.calls.setEvents as Array<(prev: unknown[]) => unknown[]> | undefined) ?? [];
      const mostRecent = eventCalls[eventCalls.length - 1]?.([]) ?? [];
      expect(mostRecent).toEqual([]);
      expect(refs.streamBuffer.current).toBe("mid-turn text");
    });
  });
});
