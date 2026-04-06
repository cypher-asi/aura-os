import { renderHook } from "@testing-library/react";

type SubscribeCallback = (event: { content: Record<string, unknown> }) => void;
const subscribeMap = new Map<string, Set<SubscribeCallback>>();

vi.mock("../stores/event-store/index", () => ({
  useEventStore: (selector: (s: { subscribe: unknown }) => unknown) =>
    selector({
      subscribe: (type: string, cb: SubscribeCallback) => {
        if (!subscribeMap.has(type)) subscribeMap.set(type, new Set());
        subscribeMap.get(type)!.add(cb);
        return () => subscribeMap.get(type)!.delete(cb);
      },
    }),
}));

const mockSetIsStreaming = vi.fn();

vi.mock("./use-stream-core", () => ({
  useStreamCore: vi.fn(() => ({
    key: "process-node:run-1:node-1",
    refs: {
      streamBuffer: { current: "" },
      thinkingBuffer: { current: "" },
      toolCalls: { current: [] },
      timeline: { current: [] },
    },
    setters: {
      setIsStreaming: mockSetIsStreaming,
      setProgressText: vi.fn(),
      setText: vi.fn(),
      setThinking: vi.fn(),
      setToolCalls: vi.fn(),
      setTimeline: vi.fn(),
      setEvents: vi.fn(),
    },
    abortRef: { current: null },
  })),
  handleTextDelta: vi.fn(),
  handleThinkingDelta: vi.fn(),
  handleToolCallStarted: vi.fn(),
  handleToolCallSnapshot: vi.fn(),
  handleToolResult: vi.fn(),
  resetStreamBuffers: vi.fn(),
  finalizeStream: vi.fn(),
}));

vi.mock("./stream/store", () => ({
  getThinkingDurationMs: vi.fn(() => 0),
}));

import { useProcessNodeStream } from "./use-process-node-stream";
import {
  resetStreamBuffers,
  finalizeStream,
  handleTextDelta,
  handleThinkingDelta,
  handleToolCallStarted,
  handleToolCallSnapshot,
  handleToolResult,
} from "./use-stream-core";

describe("useProcessNodeStream", () => {
  beforeEach(() => {
    subscribeMap.clear();
    vi.clearAllMocks();
  });

  it("returns a streamKey", () => {
    const { result } = renderHook(() => useProcessNodeStream("run-1", "node-1"));

    expect(result.current.streamKey).toBe("process-node:run-1:node-1");
  });

  it("does not subscribe when runId is undefined", () => {
    renderHook(() => useProcessNodeStream(undefined, "node-1"));

    expect(subscribeMap.size).toBe(0);
  });

  it("does not subscribe when nodeId is undefined", () => {
    renderHook(() => useProcessNodeStream("run-1", undefined));

    expect(subscribeMap.size).toBe(0);
  });

  it("subscribes to relevant events", () => {
    renderHook(() => useProcessNodeStream("run-1", "node-1"));

    expect(subscribeMap.has("process_node_executed")).toBe(true);
    expect(subscribeMap.has("text_delta")).toBe(true);
    expect(subscribeMap.has("thinking_delta")).toBe(true);
    expect(subscribeMap.has("tool_use_start")).toBe(true);
    expect(subscribeMap.has("tool_call_snapshot")).toBe(true);
    expect(subscribeMap.has("tool_result")).toBe(true);
    expect(subscribeMap.has("process_run_completed")).toBe(true);
    expect(subscribeMap.has("process_run_failed")).toBe(true);
  });

  it("starts streaming on ProcessNodeExecuted with running status", () => {
    renderHook(() => useProcessNodeStream("run-1", "node-1"));

    subscribeMap.get("process_node_executed")?.forEach((cb) =>
      cb({ content: { run_id: "run-1", node_id: "node-1", status: "running" } }),
    );

    expect(resetStreamBuffers).toHaveBeenCalled();
    expect(mockSetIsStreaming).toHaveBeenCalledWith(true);
  });

  it("finalizes on ProcessNodeExecuted with non-running status", () => {
    renderHook(() => useProcessNodeStream("run-1", "node-1"));

    subscribeMap.get("process_node_executed")?.forEach((cb) =>
      cb({ content: { run_id: "run-1", node_id: "node-1", status: "completed" } }),
    );

    expect(finalizeStream).toHaveBeenCalled();
    expect(vi.mocked(finalizeStream).mock.calls[0][4]).toEqual({ reason: "completed" });
  });

  it("ignores ProcessNodeExecuted for different run/node", () => {
    renderHook(() => useProcessNodeStream("run-1", "node-1"));

    subscribeMap.get("process_node_executed")?.forEach((cb) =>
      cb({ content: { run_id: "run-2", node_id: "node-1", status: "running" } }),
    );

    expect(resetStreamBuffers).not.toHaveBeenCalled();
  });

  it("handles TextDelta for matching context", () => {
    renderHook(() => useProcessNodeStream("run-1", "node-1"));

    subscribeMap.get("text_delta")?.forEach((cb) =>
      cb({ content: { run_id: "run-1", node_id: "node-1", text: "hello" } }),
    );

    expect(handleTextDelta).toHaveBeenCalled();
  });

  it("ignores TextDelta for mismatched context", () => {
    renderHook(() => useProcessNodeStream("run-1", "node-1"));

    subscribeMap.get("text_delta")?.forEach((cb) =>
      cb({ content: { run_id: "run-1", node_id: "node-99", text: "hello" } }),
    );

    expect(handleTextDelta).not.toHaveBeenCalled();
  });

  it("handles ThinkingDelta for matching context", () => {
    renderHook(() => useProcessNodeStream("run-1", "node-1"));

    subscribeMap.get("thinking_delta")?.forEach((cb) =>
      cb({ content: { run_id: "run-1", node_id: "node-1", thinking: "hmm" } }),
    );

    expect(handleThinkingDelta).toHaveBeenCalled();
  });

  it("handles ToolUseStart for matching context", () => {
    renderHook(() => useProcessNodeStream("run-1", "node-1"));

    subscribeMap.get("tool_use_start")?.forEach((cb) =>
      cb({ content: { run_id: "run-1", node_id: "node-1", id: "t1", name: "bash" } }),
    );

    expect(handleToolCallStarted).toHaveBeenCalled();
  });

  it("handles ToolCallSnapshot for matching context", () => {
    renderHook(() => useProcessNodeStream("run-1", "node-1"));

    subscribeMap.get("tool_call_snapshot")?.forEach((cb) =>
      cb({ content: { run_id: "run-1", node_id: "node-1", id: "t1", name: "bash", input: {} } }),
    );

    expect(handleToolCallSnapshot).toHaveBeenCalled();
  });

  it("handles ToolResult for matching context", () => {
    renderHook(() => useProcessNodeStream("run-1", "node-1"));

    subscribeMap.get("tool_result")?.forEach((cb) =>
      cb({ content: { run_id: "run-1", node_id: "node-1", id: "t1", name: "bash", result: "ok", is_error: false } }),
    );

    expect(handleToolResult).toHaveBeenCalled();
  });

  it("finalizes on ProcessRunCompleted", () => {
    renderHook(() => useProcessNodeStream("run-1", "node-1"));

    subscribeMap.get("process_run_completed")?.forEach((cb) =>
      cb({ content: { run_id: "run-1" } }),
    );

    expect(finalizeStream).toHaveBeenCalled();
    expect(vi.mocked(finalizeStream).mock.calls[0][4]).toEqual({ reason: "completed" });
  });

  it("finalizes on ProcessRunFailed", () => {
    renderHook(() => useProcessNodeStream("run-1", "node-1"));

    subscribeMap.get("process_run_failed")?.forEach((cb) =>
      cb({ content: { run_id: "run-1", error: "stream dropped" } }),
    );

    expect(finalizeStream).toHaveBeenCalled();
    expect(vi.mocked(finalizeStream).mock.calls[0][4]).toEqual({
      reason: "failed",
      message: "stream dropped",
    });
  });

  it("ignores ProcessRunCompleted for different runId", () => {
    renderHook(() => useProcessNodeStream("run-1", "node-1"));

    subscribeMap.get("process_run_completed")?.forEach((cb) =>
      cb({ content: { run_id: "run-other" } }),
    );

    expect(finalizeStream).not.toHaveBeenCalled();
  });

  it("sets streaming eagerly when isActive is true", () => {
    renderHook(() => useProcessNodeStream("run-1", "node-1", true));

    expect(mockSetIsStreaming).toHaveBeenCalledWith(true);
  });

  it("cleans up subscriptions on unmount", () => {
    const { unmount } = renderHook(() => useProcessNodeStream("run-1", "node-1"));

    const sizeBefore = subscribeMap.get("text_delta")?.size ?? 0;
    unmount();
    const sizeAfter = subscribeMap.get("text_delta")?.size ?? 0;

    expect(sizeAfter).toBeLessThan(sizeBefore);
  });
});
