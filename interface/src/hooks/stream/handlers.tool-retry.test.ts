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
  handleToolCallStarted,
  handleToolCallSnapshot,
  handleToolResult,
  handleToolCallRetrying,
  handleToolCallFailed,
} from "./handlers";
import type { ToolCallEntry } from "../../shared/types/stream";
import { makeRefs, makeSetters } from "./handlers.test-helpers";

describe("stream/handlers — tool retry and failure", () => {
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
});
