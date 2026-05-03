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
  handleToolCallStarted,
  handleToolCallSnapshot,
  handleToolCall,
  handleToolResult,
} from "./handlers";
import { makeRefs, makeSetters } from "./handlers.test-helpers";

describe("stream/handlers — tool call lifecycle", () => {
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

    it("normalizes stringified JSON input before storing it", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleToolCall(refs, setters, {
        id: "tc1",
        name: "submit_plan",
        input: "{\"approach\":\"fix it\",\"files_to_modify\":[\"a.ts\"]}" as unknown as Record<string, unknown>,
      });

      expect(refs.toolCalls.current[0].input).toEqual({
        approach: "fix it",
        files_to_modify: ["a.ts"],
      });
      expect(refs.toolCalls.current[0].input).not.toHaveProperty("0");
    });

    it("preserves malformed string input without spreading characters", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleToolCall(refs, setters, {
        id: "tc1",
        name: "submit_plan",
        input: "not json" as unknown as Record<string, unknown>,
      });

      expect(refs.toolCalls.current[0].input).toEqual({ raw_input: "not json" });
      expect(refs.toolCalls.current[0].input).not.toHaveProperty("0");
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

    it("normalizes stringified snapshot input before merging", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleToolCallStarted(refs, setters, { id: "tc1", name: "submit_plan" });
      handleToolCallSnapshot(refs, setters, {
        id: "tc1",
        name: "submit_plan",
        input: "{\"approach\":\"fix it\"}" as unknown as Record<string, unknown>,
      });

      expect(refs.toolCalls.current[0].input).toEqual({ approach: "fix it" });
      expect(refs.toolCalls.current[0].input).not.toHaveProperty("0");
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
});
