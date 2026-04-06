import { renderHook } from "@testing-library/react";

type SubscribeCallback = (event: { content: Record<string, unknown>; project_id?: string }) => void;
const subscribeMap = new Map<string, Set<SubscribeCallback>>();

vi.mock("../stores/event-store/index", () => ({
  useEventStore: Object.assign(
    (selector: (s: { subscribe: unknown }) => unknown) =>
      selector({
        subscribe: (type: string, cb: SubscribeCallback) => {
          if (!subscribeMap.has(type)) subscribeMap.set(type, new Set());
          subscribeMap.get(type)!.add(cb);
          return () => subscribeMap.get(type)!.delete(cb);
        },
      }),
    {
      getState: () => ({
        seedTaskOutput: vi.fn(),
      }),
    },
  ),
  getTaskOutput: vi.fn(() => ({ text: "" })),
}));

const mockSetIsStreaming = vi.fn();
const mockSetProgressText = vi.fn();

vi.mock("./use-stream-core", () => ({
  useStreamCore: vi.fn(() => ({
    key: "task:test-task-1",
    refs: {
      streamBuffer: { current: "" },
      thinkingBuffer: { current: "" },
      toolCalls: { current: [] },
      timeline: { current: [] },
    },
    setters: {
      setIsStreaming: mockSetIsStreaming,
      setProgressText: mockSetProgressText,
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
  handleToolResult: vi.fn(),
  handleAssistantTurnBoundary: vi.fn(),
  resetStreamBuffers: vi.fn(),
  finalizeStream: vi.fn(),
}));

vi.mock("./stream/store", () => ({
  getThinkingDurationMs: vi.fn(() => 0),
}));

import { useTaskStream } from "./use-task-stream";
import { resetStreamBuffers, finalizeStream, handleTextDelta, handleToolCallStarted, handleToolResult } from "./use-stream-core";

describe("useTaskStream", () => {
  beforeEach(() => {
    subscribeMap.clear();
    vi.clearAllMocks();
  });

  it("returns a streamKey", () => {
    const { result } = renderHook(() => useTaskStream("test-task-1"));

    expect(result.current.streamKey).toBe("task:test-task-1");
  });

  it("does not subscribe when taskId is undefined", () => {
    renderHook(() => useTaskStream(undefined));

    expect(subscribeMap.size).toBe(0);
  });

  it("subscribes to relevant event types when taskId is provided", () => {
    renderHook(() => useTaskStream("test-task-1"));

    expect(subscribeMap.has("task_started")).toBe(true);
    expect(subscribeMap.has("text_delta")).toBe(true);
    expect(subscribeMap.has("thinking_delta")).toBe(true);
    expect(subscribeMap.has("tool_use_start")).toBe(true);
    expect(subscribeMap.has("tool_result")).toBe(true);
    expect(subscribeMap.has("task_completed")).toBe(true);
    expect(subscribeMap.has("task_failed")).toBe(true);
  });

  it("sets streaming on TaskStarted event", () => {
    renderHook(() => useTaskStream("task-1"));

    subscribeMap.get("task_started")?.forEach((cb) =>
      cb({ content: { task_id: "task-1" } }),
    );

    expect(resetStreamBuffers).toHaveBeenCalled();
    expect(mockSetIsStreaming).toHaveBeenCalledWith(true);
  });

  it("ignores TaskStarted for different taskId", () => {
    renderHook(() => useTaskStream("task-1"));

    subscribeMap.get("task_started")?.forEach((cb) =>
      cb({ content: { task_id: "task-other" } }),
    );

    expect(resetStreamBuffers).not.toHaveBeenCalled();
  });

  it("handles TextDelta for matching taskId", () => {
    renderHook(() => useTaskStream("task-1"));

    subscribeMap.get("text_delta")?.forEach((cb) =>
      cb({ content: { task_id: "task-1", text: "hello" } }),
    );

    expect(handleTextDelta).toHaveBeenCalled();
  });

  it("ignores TextDelta for different taskId", () => {
    renderHook(() => useTaskStream("task-1"));

    subscribeMap.get("text_delta")?.forEach((cb) =>
      cb({ content: { task_id: "task-other", text: "hello" } }),
    );

    expect(handleTextDelta).not.toHaveBeenCalled();
  });

  it("handles ToolUseStart for matching taskId", () => {
    renderHook(() => useTaskStream("task-1"));

    subscribeMap.get("tool_use_start")?.forEach((cb) =>
      cb({ content: { task_id: "task-1", id: "tool-1", name: "bash" } }),
    );

    expect(handleToolCallStarted).toHaveBeenCalled();
  });

  it("handles ToolResult for matching taskId", () => {
    renderHook(() => useTaskStream("task-1"));

    subscribeMap.get("tool_result")?.forEach((cb) =>
      cb({ content: { task_id: "task-1", id: "tool-1", name: "bash", result: "ok", is_error: false } }),
    );

    expect(handleToolResult).toHaveBeenCalled();
  });

  it("calls finalizeStream on TaskCompleted", () => {
    renderHook(() => useTaskStream("task-1"));

    subscribeMap.get("task_completed")?.forEach((cb) =>
      cb({ content: { task_id: "task-1" } }),
    );

    expect(finalizeStream).toHaveBeenCalled();
    expect(vi.mocked(finalizeStream).mock.calls[0][4]).toEqual({ reason: "completed" });
  });

  it("calls finalizeStream on TaskFailed", () => {
    renderHook(() => useTaskStream("task-1"));

    subscribeMap.get("task_failed")?.forEach((cb) =>
      cb({ content: { task_id: "task-1", reason: "timeout" } }),
    );

    expect(finalizeStream).toHaveBeenCalled();
    expect(vi.mocked(finalizeStream).mock.calls[0][4]).toEqual({
      reason: "failed",
      message: "timeout",
    });
  });

  it("sets streaming eagerly when isActive is true", () => {
    renderHook(() => useTaskStream("task-1", true));

    expect(mockSetIsStreaming).toHaveBeenCalledWith(true);
  });

  it("handles Progress event for matching taskId", () => {
    renderHook(() => useTaskStream("task-1"));

    subscribeMap.get("progress")?.forEach((cb) =>
      cb({ content: { task_id: "task-1", stage: "Compiling..." } }),
    );

    expect(mockSetProgressText).toHaveBeenCalledWith("Compiling...");
  });

  it("cleans up subscriptions on unmount", () => {
    const { unmount } = renderHook(() => useTaskStream("task-1"));

    const countBefore = subscribeMap.get("task_started")?.size ?? 0;
    unmount();
    const countAfter = subscribeMap.get("task_started")?.size ?? 0;

    expect(countAfter).toBeLessThan(countBefore);
  });
});
