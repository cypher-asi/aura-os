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
  isStreamDroppedError,
  normalizeStreamError,
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
    it("adds error message to messages without the legacy `*Error: ...*` markdown decorator", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleStreamError(refs, setters, "something broke");

      const setEventsCalls = setters.calls.setEvents;
      expect(setEventsCalls).toBeDefined();

      const lastCall = setters.calls.setEvents[setters.calls.setEvents.length - 1];
      const updater = lastCall as (prev: unknown[]) => unknown[];
      const result = updater([]) as Array<{
        content: string;
        errorMessage?: string;
        displayVariant?: string;
      }>;
      // The error string moved to its own field; the bubble's
      // `content` is now reserved for the (empty here) streaming
      // prefix only.
      expect(result[0].errorMessage).toBe("something broke");
      expect(result[0].errorMessage).not.toMatch(/\*Error: /);
      expect(result[0].content).toBe("");
      expect(result[0].displayVariant).toBeUndefined();
    });

    it("keeps the buffered prefix in `content` and routes the synthesized error string to `errorMessage`", () => {
      const refs = makeRefs();
      refs.streamBuffer.current = "partial response";
      const setters = makeSetters();

      handleStreamError(refs, setters, "connection lost");

      const lastCall = setters.calls.setEvents[setters.calls.setEvents.length - 1];
      const updater = lastCall as (prev: unknown[]) => unknown[];
      const result = updater([]) as Array<{ content: string; errorMessage?: string }>;
      // The streaming buffer captured pre-error stays in `content`
      // verbatim (no `*Error: ...*` decorator, no extra newlines)
      // so MessageBubble can render it through LLMOutput unchanged.
      expect(result[0].content).toBe("partial response");
      // The synthesized error string lives in the dedicated
      // `errorMessage` field that MessageBubble surfaces inside
      // the Support ID + Report Bug action row.
      expect(result[0].errorMessage).toBe("connection lost");
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
      const result = updater([]) as Array<{
        content: string;
        errorMessage?: string;
        displayVariant?: string;
      }>;

      expect(result[0].errorMessage).toBe("You have no credits remaining. Buy more credits to continue.");
      expect(result[0].content).toBe("");
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
      const result = updater([]) as Array<{
        content: string;
        errorMessage?: string;
        displayVariant?: string;
      }>;

      expect(result[0].displayVariant).toBe("streamDropped");
      expect(result[0].content).toBe("");
      expect(result[0].errorMessage).toMatch(/recovered from history/i);
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
      const result = updater([]) as Array<{
        content: string;
        errorMessage?: string;
        displayVariant?: string;
      }>;

      expect(result[0].displayVariant).toBe("harnessCapacityExhaustedError");
      expect(result[0].errorMessage).toBe("Server is busy — try again in 5 seconds.");
      expect(result[0].content).toBe("");
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
      const result = updater([]) as Array<{
        content: string;
        errorMessage?: string;
        displayVariant?: string;
      }>;

      expect(result[0].displayVariant).toBe("streamDropped");
      expect(result[0].content).toBe("");
      expect(result[0].errorMessage).toMatch(/recovered from history/i);
    });

    it("classifies server-side stream_truncated errors as a streamDropped banner", () => {
      const refs = makeRefs();
      const setters = makeSetters();
      vi.mocked(isInsufficientCreditsError).mockReturnValue(false);

      handleStreamError(refs, setters, {
        message: "Agent stream ended before the turn completed.",
        code: "stream_truncated",
        recoverable: true,
      });

      const lastCall = setters.calls.setEvents[setters.calls.setEvents.length - 1];
      const updater = lastCall as (prev: unknown[]) => unknown[];
      const result = updater([]) as Array<{
        content: string;
        errorMessage?: string;
        displayVariant?: string;
      }>;

      expect(result[0].displayVariant).toBe("streamDropped");
      expect(result[0].content).toBe("");
      expect(result[0].errorMessage).toMatch(/recovered from history/i);
    });
  });

  describe("watchdog stream-drop errors", () => {
    it("recognizes turn_timeout as streamDropped", () => {
      expect(
        isStreamDroppedError({
          code: "turn_timeout",
          message: "Turn timed out before producing another event",
        }),
      ).toBe(true);
      expect(
        isStreamDroppedError({
          code: "TURN_TIMEOUT",
          message: "Turn timed out before producing another event",
        }),
      ).toBe(true);
    });

    it("recognizes stream_stalled as streamDropped", () => {
      expect(
        isStreamDroppedError({
          code: "stream_stalled",
          message: "Stream stalled before producing another event",
        }),
      ).toBe(true);
      expect(
        isStreamDroppedError({
          code: "STREAM_STALLED",
          message: "Stream stalled before producing another event",
        }),
      ).toBe(true);
    });

    it.each(["turn_timeout", "stream_stalled"])(
      "normalizes %s as a streamDropped display variant",
      (code) => {
        const normalized = normalizeStreamError({
          code,
          message: "watchdog fired",
        });

        expect(normalized.displayVariant).toBe("streamDropped");
        expect(normalized.message).toMatch(/connection to the agent dropped/i);
      },
    );
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

    it("always emits a synthetic failure event with errorMessage when reason=failed and the buffer is empty", () => {
      // Regression for "Task failed without producing output." showing
      // in the Run pane: a `task_failed` arriving before any
      // text_delta / tool result used to leave `events.length === 0`,
      // `snapshotTaskTurns` would bail on its empty-events guard, and
      // the row collapsed to the generic empty-state copy. The
      // failed-terminal path must always persist an event carrying the
      // failure message so the turn cache (and therefore the post-
      // completion view) has something to render.
      const refs = makeRefs();
      const setters = makeSetters();
      const abortRef = { current: null as AbortController | null };

      finalizeStream(refs, setters, abortRef, true, {
        reason: "failed",
        message: "upstream returned 503 Service Unavailable",
      });

      const lastCall = setters.calls.setEvents[setters.calls.setEvents.length - 1];
      const updater = lastCall as (prev: unknown[]) => Array<{
        id: string;
        role: string;
        content: string;
        errorMessage?: string;
      }>;
      const result = updater([]);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("assistant");
      expect(result[0].content).toBe("");
      expect(result[0].errorMessage).toBe(
        "upstream returned 503 Service Unavailable",
      );
      expect(result[0].id.startsWith("stream-")).toBe(true);
    });

    it("synthesises a fallback errorMessage when reason=failed and message is empty", () => {
      // Some `task_failed` payloads arrive without any reason / error /
      // message field. The synthetic failure event still needs a
      // non-empty errorMessage so the post-completion MessageBubble
      // surfaces something actionable instead of an empty row.
      const refs = makeRefs();
      const setters = makeSetters();
      const abortRef = { current: null as AbortController | null };

      finalizeStream(refs, setters, abortRef, true, { reason: "failed" });

      const lastCall = setters.calls.setEvents[setters.calls.setEvents.length - 1];
      const updater = lastCall as (prev: unknown[]) => Array<{
        errorMessage?: string;
      }>;
      const result = updater([]);
      expect(result[0].errorMessage).toBe(
        "task failed without a reason from the harness",
      );
    });

    it("folds the live progress label into the failure event when there is no buffered text", () => {
      // When the task fails before any text_delta has landed, the
      // cooking-indicator label ("Submitting plan…", "Cooking…") is
      // the only signal the user had of what phase the loop was in.
      // The bootstrap captures it from the live `progressText` slot
      // before finalize resets it; finalize folds it into the
      // bubble's content so the post-completion view shows where the
      // run was stuck.
      const refs = makeRefs();
      const setters = makeSetters();
      const abortRef = { current: null as AbortController | null };

      finalizeStream(refs, setters, abortRef, true, {
        reason: "failed",
        message: "stream terminated",
        progressText: "Submitting plan…",
      });

      const lastCall = setters.calls.setEvents[setters.calls.setEvents.length - 1];
      const updater = lastCall as (prev: unknown[]) => Array<{
        content: string;
        errorMessage?: string;
      }>;
      const result = updater([]);
      expect(result[0].content).toBe("_was: Submitting plan…_");
      expect(result[0].errorMessage).toBe("stream terminated");
    });

    it("keeps the buffered text intact and does not overwrite it with the progress hint", () => {
      // When the task fails AFTER streaming some text, the buffered
      // content wins — the progress hint is a fallback for the empty
      // case only, otherwise it would smudge the LLM's last partial
      // response with cooking-indicator chrome.
      const refs = makeRefs();
      refs.streamBuffer.current = "partial reply";
      const setters = makeSetters();
      const abortRef = { current: null as AbortController | null };

      finalizeStream(refs, setters, abortRef, true, {
        reason: "failed",
        message: "stream terminated",
        progressText: "Submitting plan…",
      });

      const lastCall = setters.calls.setEvents[setters.calls.setEvents.length - 1];
      const updater = lastCall as (prev: unknown[]) => Array<{
        content: string;
        errorMessage?: string;
      }>;
      const result = updater([]);
      expect(result[0].content).toBe("partial reply");
      expect(result[0].errorMessage).toBe("stream terminated");
    });

    it("does not emit a synthetic event for reason=completed when nothing was buffered", () => {
      // Sanity: the failed-terminal forcing must not bleed into the
      // completed-terminal path. A clean no-op completion should
      // still leave `events` untouched so the row renders as a bare
      // header rather than an empty assistant bubble.
      const refs = makeRefs();
      const setters = makeSetters();
      const abortRef = { current: null as AbortController | null };

      finalizeStream(refs, setters, abortRef, true, { reason: "completed" });

      const eventCalls =
        (setters.calls.setEvents as Array<(prev: unknown[]) => unknown[]> | undefined) ?? [];
      const mostRecent = eventCalls[eventCalls.length - 1]?.([]) ?? [];
      expect(mostRecent).toEqual([]);
    });

    it("saves the full buffered content even when only part of it was revealed", () => {
      const refs = makeRefs();
      const setters = makeSetters();
      const abortRef = { current: null as AbortController | null };

      handleTextDelta(refs, setters, null, "hello world again");
      // Stage a mid-reveal state: the buffer holds the full text but
      // the display cursor has only caught up to "hello".
      refs.displayedTextLength.current = 5;

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

    it("replaces a re-delivered turn in place instead of appending a duplicate", () => {
      const refs = makeRefs();
      const setters = makeSetters();

      handleEventSaved(refs, setters, {
        event_id: "evt-1",
        content: "first turn",
        content_blocks: [],
      } as never);

      const setEvents = setters.calls.setEvents?.[0] as
        | ((prev: unknown[]) => Array<{ id: string; content: string }>)
        | undefined;
      expect(setEvents).toBeDefined();

      // Partition already holds this committed turn (from a prior attach)
      // plus a trailing placeholder the replay's re-streamed deltas just
      // rebuilt for the same turn. The re-delivery must reconcile in place
      // rather than stack a duplicate — this is what lets the subagent
      // attach skip the blanking `setEvents([])`.
      const result = setEvents?.([
        { id: "evt-1", clientId: "evt-1", role: "assistant", content: "first turn" },
        { id: "evt-2", clientId: "evt-2", role: "assistant", content: "second turn" },
        { id: "stream-xyz", clientId: "stream-xyz", role: "assistant", content: "first tur" },
      ]);

      expect(result).toHaveLength(2);
      expect(result?.map((event) => event.id)).toEqual(["evt-1", "evt-2"]);
      expect(result?.[0]).toMatchObject({ id: "evt-1", content: "first turn" });
    });
  });
});
