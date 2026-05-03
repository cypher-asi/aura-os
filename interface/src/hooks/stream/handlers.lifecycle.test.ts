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
  handleStreamError,
  finalizeStream,
  handleAssistantTurnBoundary,
  handleEventSaved,
  handleTextDelta,
} from "./handlers";
import {
  dispatchInsufficientCredits,
  isInsufficientCreditsError,
  isHarnessCapacityExhaustedError,
} from "../../api/client";
import type { ToolCallEntry } from "../../shared/types/stream";
import { makeRefs, makeSetters } from "./handlers.test-helpers";

describe("stream/handlers — lifecycle (error / finalize / boundary / saved)", () => {
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

    it("preserves create_spec markdown when the model call times out", () => {
      const refs = makeRefs();
      refs.toolCalls.current = [
        {
          id: "tc1",
          name: "create_spec",
          input: {
            title: "01: Foundation",
            markdown_contents: "# 01: Foundation\n\nLong draft body",
          },
          pending: true,
          started: true,
        },
      ];
      const setters = makeSetters();

      handleStreamError(refs, setters, "Model call timed out after 180s");

      const lastCall = setters.calls.setEvents[setters.calls.setEvents.length - 1];
      const updater = lastCall as (prev: unknown[]) => unknown[];
      const result = updater([]) as Array<{ toolCalls?: ToolCallEntry[] }>;
      const tool = result[0].toolCalls?.[0];

      expect(tool?.pending).toBe(false);
      expect(tool?.isError).toBe(true);
      expect(tool?.input.markdown_contents).toContain("Long draft body");
      expect(tool?.result).toContain("Spec draft preserved after model timeout");
      expect(tool?.result).toContain("Model call timed out after 180s");
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

    it("classifies SSE idle timeout as a streamDropped banner instead of inlining the raw error", () => {
      const refs = makeRefs();
      const setters = makeSetters();
      vi.mocked(isInsufficientCreditsError).mockReturnValue(false);

      class SSEIdleTimeoutError extends Error {
        constructor() {
          super("SSE idle timeout");
          this.name = "SSEIdleTimeoutError";
        }
      }

      handleStreamError(refs, setters, new SSEIdleTimeoutError());

      const lastCall = setters.calls.setEvents[setters.calls.setEvents.length - 1];
      const updater = lastCall as (prev: unknown[]) => unknown[];
      const result = updater([]) as Array<{ content: string; displayVariant?: string }>;

      expect(result[0].displayVariant).toBe("streamDropped");
      expect(result[0].content).not.toMatch(/\*Error: /);
      expect(result[0].content).toMatch(/recovered from history/i);
    });

    it("classifies harness_capacity_exhausted errors as a Server is busy banner with the retry hint", () => {
      const refs = makeRefs();
      const setters = makeSetters();
      vi.mocked(isInsufficientCreditsError).mockReturnValue(false);
      vi.mocked(isHarnessCapacityExhaustedError).mockReturnValue({
        configured_cap: 96,
        retry_after_seconds: 5,
      });

      handleStreamError(refs, setters, new Error("503 capacity exhausted"));

      const lastCall = setters.calls.setEvents[setters.calls.setEvents.length - 1];
      const updater = lastCall as (prev: unknown[]) => unknown[];
      const result = updater([]) as Array<{ content: string; displayVariant?: string }>;

      expect(result[0].displayVariant).toBe("harnessCapacityExhaustedError");
      expect(result[0].content).toBe("Server is busy — try again in 5 seconds.");
      expect(result[0].content).not.toMatch(/\*Error: /);
      vi.mocked(isHarnessCapacityExhaustedError).mockReturnValue(null);
    });

    it("classifies server-side stream_lagged errors as a streamDropped banner", () => {
      const refs = makeRefs();
      const setters = makeSetters();
      vi.mocked(isInsufficientCreditsError).mockReturnValue(false);

      handleStreamError(refs, setters, {
        message: "Stream lagged (12 events skipped). Reloading history…",
        code: "stream_lagged",
        recoverable: true,
      });

      const lastCall = setters.calls.setEvents[setters.calls.setEvents.length - 1];
      const updater = lastCall as (prev: unknown[]) => unknown[];
      const result = updater([]) as Array<{ content: string; displayVariant?: string }>;

      expect(result[0].displayVariant).toBe("streamDropped");
      expect(result[0].content).not.toMatch(/\*Error: /);
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

  describe("handleAssistantTurnBoundary", () => {
    it("saves a stream-* event with tool calls when the turn has no buffered text", () => {
      // Regression: tool-only assistant turns (no text, only tool_use blocks)
      // used to be silently dropped. The boundary skipped the save when
      // `streamBuffer` was empty, then `resetStreamBuffers` (called shortly
      // after on AssistantMessageEnd / Done) wiped `refs.toolCalls.current`,
      // so the turn never landed in `events`.
      const refs = makeRefs();
      const tc: ToolCallEntry = {
        id: "tc-tool-only",
        name: "search",
        input: { q: "kittens" },
        pending: false,
        started: true,
      };
      refs.toolCalls.current = [tc];
      refs.timeline.current = [
        { id: "tl-1", kind: "tool", toolCallId: "tc-tool-only" },
      ];
      const setters = makeSetters();

      handleAssistantTurnBoundary(refs, setters);

      const eventCalls =
        (setters.calls.setEvents as Array<(prev: unknown[]) => unknown[]> | undefined) ?? [];
      expect(eventCalls).toHaveLength(1);
      const result = eventCalls[0]([]) as Array<{
        id: string;
        role: string;
        content: string;
        toolCalls?: ToolCallEntry[];
        timeline?: unknown[];
      }>;
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("assistant");
      expect(result[0].content).toBe("");
      expect(result[0].toolCalls).toHaveLength(1);
      expect(result[0].toolCalls?.[0].id).toBe("tc-tool-only");
      expect(result[0].id.startsWith("stream-")).toBe(true);

      // The boundary marks the tool as snapshotted so a subsequent
      // finalize/boundary won't re-emit it.
      expect(refs.snapshottedToolCallIds.current.has("tc-tool-only")).toBe(true);
    });

    it("does nothing when there are no buffers and no new tool calls", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleAssistantTurnBoundary(refs, setters);

      expect(setters.calls.setEvents).toBeUndefined();
    });

    it("does not re-emit tool calls already snapshotted by a prior boundary", () => {
      const refs = makeRefs();
      refs.toolCalls.current = [
        {
          id: "tc-already-saved",
          name: "search",
          input: {},
          pending: false,
          started: true,
        },
      ];
      refs.snapshottedToolCallIds.current = new Set(["tc-already-saved"]);
      const setters = makeSetters();

      handleAssistantTurnBoundary(refs, setters);

      expect(setters.calls.setEvents).toBeUndefined();
    });
  });

  describe("handleEventSaved", () => {
    it("preserves fuller streamed content when the saved event is stale", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleEventSaved(refs, setters, {
        event_id: "evt-assistant",
        content: "",
        content_blocks: [],
      } as never);

      const setEvents = setters.calls.setEvents?.[0] as
        | ((prev: unknown[]) => Array<{ id: string; content: string }>)
        | undefined;
      expect(setEvents).toBeDefined();

      const result = setEvents?.([
        { id: "stream-assistant", role: "assistant", content: "full streamed reply" },
      ]);

      expect(result).toHaveLength(1);
      expect(result?.[0]).toMatchObject({
        id: "evt-assistant",
        role: "assistant",
        content: "full streamed reply",
      });
    });
  });
});
