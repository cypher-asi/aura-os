import { renderHook, act } from "@testing-library/react";
import { useLoopStatus } from "./use-loop-status";

type SubscribeCallback = (event: Record<string, string | undefined>) => void;

const subscribeMap = new Map<string, Set<SubscribeCallback>>();

vi.mock("../stores/event-store", () => ({
  useEventStore: (selector: (s: { subscribe: unknown }) => unknown) =>
    selector({
      subscribe: (type: string, cb: SubscribeCallback) => {
        if (!subscribeMap.has(type)) subscribeMap.set(type, new Set());
        subscribeMap.get(type)!.add(cb);
        return () => subscribeMap.get(type)!.delete(cb);
      },
    }),
}));

describe("useLoopStatus", () => {
  beforeEach(() => {
    subscribeMap.clear();
  });

  it("returns null project and agent initially", () => {
    const { result } = renderHook(() => useLoopStatus());

    expect(result.current.automatingProjectId).toBeNull();
    expect(result.current.automatingAgentInstanceId).toBeNull();
  });

  it("sets project and agent on loop_started", () => {
    const { result } = renderHook(() => useLoopStatus("agent-1"));

    act(() => {
      subscribeMap.get("loop_started")!.forEach((cb) =>
        cb({ project_id: "proj-1" }),
      );
    });

    expect(result.current.automatingProjectId).toBe("proj-1");
    expect(result.current.automatingAgentInstanceId).toBe("agent-1");
  });

  it("clears on loop_stopped", () => {
    const { result } = renderHook(() => useLoopStatus("agent-1"));

    act(() => {
      subscribeMap.get("loop_started")!.forEach((cb) =>
        cb({ project_id: "proj-1" }),
      );
    });

    act(() => {
      subscribeMap.get("loop_stopped")!.forEach((cb) => cb({}));
    });

    expect(result.current.automatingProjectId).toBeNull();
    expect(result.current.automatingAgentInstanceId).toBeNull();
  });

  it("does not clear on loop_stopped for a different project", () => {
    const { result } = renderHook(() => useLoopStatus("agent-1"));

    act(() => {
      subscribeMap.get("loop_started")!.forEach((cb) =>
        cb({ project_id: "proj-1", agent_id: "agent-1" }),
      );
    });

    act(() => {
      subscribeMap.get("loop_stopped")!.forEach((cb) =>
        cb({ project_id: "proj-2", agent_id: "agent-x" }),
      );
    });

    expect(result.current.automatingProjectId).toBe("proj-1");
    expect(result.current.automatingAgentInstanceId).toBe("agent-1");
  });

  it("clears on loop_paused", () => {
    const { result } = renderHook(() => useLoopStatus("agent-1"));

    act(() => {
      subscribeMap.get("loop_started")!.forEach((cb) =>
        cb({ project_id: "proj-1" }),
      );
    });

    act(() => {
      subscribeMap.get("loop_paused")!.forEach((cb) => cb({}));
    });

    expect(result.current.automatingProjectId).toBeNull();
  });

  it("clears on loop_finished", () => {
    const { result } = renderHook(() => useLoopStatus("agent-1"));

    act(() => {
      subscribeMap.get("loop_started")!.forEach((cb) =>
        cb({ project_id: "proj-1" }),
      );
    });

    act(() => {
      subscribeMap.get("loop_finished")!.forEach((cb) => cb({}));
    });

    expect(result.current.automatingProjectId).toBeNull();
  });

  it("uses latest agent instance id via ref", () => {
    const { result, rerender } = renderHook(
      ({ agentId }: { agentId: string }) => useLoopStatus(agentId),
      { initialProps: { agentId: "agent-1" } },
    );

    rerender({ agentId: "agent-2" });

    act(() => {
      subscribeMap.get("loop_started")!.forEach((cb) =>
        cb({ project_id: "proj-1" }),
      );
    });

    expect(result.current.automatingAgentInstanceId).toBe("agent-2");
  });
});
