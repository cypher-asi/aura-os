import { renderHook, act } from "@testing-library/react";
import { useTaskStatus } from "./use-task-status";

type SubscribeCallback = (event: Record<string, string | undefined>) => void;

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

describe("useTaskStatus", () => {
  beforeEach(() => {
    subscribeMap.clear();
  });

  it("returns null initial state", () => {
    const { result } = renderHook(() => useTaskStatus("task-1"));

    expect(result.current.liveStatus).toBeNull();
    expect(result.current.liveSessionId).toBeNull();
    expect(result.current.failReason).toBeNull();
  });

  it("sets in_progress on task_started", () => {
    const { result } = renderHook(() => useTaskStatus("task-1"));

    act(() => {
      subscribeMap.get("task_started")!.forEach((cb) =>
        cb({ task_id: "task-1", session_id: "sess-1" }),
      );
    });

    expect(result.current.liveStatus).toBe("in_progress");
    expect(result.current.liveSessionId).toBe("sess-1");
  });

  it("sets done on task_completed", () => {
    const { result } = renderHook(() => useTaskStatus("task-1"));

    act(() => {
      subscribeMap.get("task_completed")!.forEach((cb) =>
        cb({ task_id: "task-1" }),
      );
    });

    expect(result.current.liveStatus).toBe("done");
  });

  it("sets failed with reason on task_failed", () => {
    const { result } = renderHook(() => useTaskStatus("task-1"));

    act(() => {
      subscribeMap.get("task_failed")!.forEach((cb) =>
        cb({ task_id: "task-1", reason: "timeout" }),
      );
    });

    expect(result.current.liveStatus).toBe("failed");
    expect(result.current.failReason).toBe("timeout");
  });

  it("ignores events for different tasks", () => {
    const { result } = renderHook(() => useTaskStatus("task-1"));

    act(() => {
      subscribeMap.get("task_started")!.forEach((cb) =>
        cb({ task_id: "task-other" }),
      );
    });

    expect(result.current.liveStatus).toBeNull();
  });

  it("resets state when taskId changes", () => {
    const { result, rerender } = renderHook(
      ({ taskId }: { taskId: string }) => useTaskStatus(taskId),
      { initialProps: { taskId: "task-1" } },
    );

    act(() => {
      subscribeMap.get("task_started")!.forEach((cb) =>
        cb({ task_id: "task-1", session_id: "sess-1" }),
      );
    });

    expect(result.current.liveStatus).toBe("in_progress");

    rerender({ taskId: "task-2" });

    expect(result.current.liveStatus).toBeNull();
    expect(result.current.liveSessionId).toBeNull();
    expect(result.current.failReason).toBeNull();
  });

  it("exposes setLiveStatus and setFailReason", () => {
    const { result } = renderHook(() => useTaskStatus("task-1"));

    act(() => {
      result.current.setLiveStatus("custom");
    });
    expect(result.current.liveStatus).toBe("custom");

    act(() => {
      result.current.setFailReason("manual");
    });
    expect(result.current.failReason).toBe("manual");
  });
});
