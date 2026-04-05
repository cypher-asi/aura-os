import { renderHook, waitFor, act } from "@testing-library/react";

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

const mockGetRemoteAgentState = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    swarm: {
      getRemoteAgentState: (...args: unknown[]) => mockGetRemoteAgentState(...args),
    },
  },
}));

import { useRemoteAgentState } from "./use-remote-agent-state";

describe("useRemoteAgentState", () => {
  beforeEach(() => {
    subscribeMap.clear();
    mockGetRemoteAgentState.mockReset();
  });

  it("returns loading state initially", () => {
    mockGetRemoteAgentState.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useRemoteAgentState("agent-1"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("does not fetch when agentId is undefined", () => {
    const { result } = renderHook(() => useRemoteAgentState(undefined));

    expect(result.current.loading).toBe(true);
    expect(mockGetRemoteAgentState).not.toHaveBeenCalled();
  });

  it("fetches and returns data on success", async () => {
    const vmState = {
      state: "running",
      uptime_seconds: 3600,
      active_sessions: 2,
      error_message: null,
    };
    mockGetRemoteAgentState.mockResolvedValue(vmState);

    const { result } = renderHook(() => useRemoteAgentState("agent-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(vmState);
    expect(result.current.error).toBeNull();
    expect(mockGetRemoteAgentState).toHaveBeenCalledWith("agent-1");
  });

  it("sets error on fetch failure", async () => {
    mockGetRemoteAgentState.mockRejectedValue(new Error("connection refused"));

    const { result } = renderHook(() => useRemoteAgentState("agent-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("connection refused");
    expect(result.current.data).toBeNull();
  });

  it("updates data from WebSocket event", async () => {
    mockGetRemoteAgentState.mockResolvedValue({
      state: "running",
      uptime_seconds: 100,
      active_sessions: 1,
      error_message: null,
    });

    const { result } = renderHook(() => useRemoteAgentState("agent-1"));

    await waitFor(() => {
      expect(result.current.data).not.toBeNull();
    });

    act(() => {
      subscribeMap.get("remote_agent_state_changed")?.forEach((cb) =>
        cb({
          content: {
            agent_id: "agent-1",
            state: "hibernating",
            uptime_seconds: 200,
            active_sessions: 0,
            error_message: null,
          },
        }),
      );
    });

    expect(result.current.data?.state).toBe("hibernating");
  });

  it("ignores WebSocket event for different agent", async () => {
    mockGetRemoteAgentState.mockResolvedValue({
      state: "running",
      uptime_seconds: 100,
      active_sessions: 1,
      error_message: null,
    });

    const { result } = renderHook(() => useRemoteAgentState("agent-1"));

    await waitFor(() => {
      expect(result.current.data?.state).toBe("running");
    });

    act(() => {
      subscribeMap.get("remote_agent_state_changed")?.forEach((cb) =>
        cb({
          content: {
            agent_id: "agent-2",
            state: "stopped",
            uptime_seconds: 0,
            active_sessions: 0,
            error_message: null,
          },
        }),
      );
    });

    expect(result.current.data?.state).toBe("running");
  });

  it("cleans up subscription on unmount", async () => {
    mockGetRemoteAgentState.mockResolvedValue({ state: "running" });

    const { unmount } = renderHook(() => useRemoteAgentState("agent-1"));

    await waitFor(() => {
      expect(mockGetRemoteAgentState).toHaveBeenCalledOnce();
    });

    const subsBefore = subscribeMap.get("remote_agent_state_changed")?.size ?? 0;
    unmount();
    const subsAfter = subscribeMap.get("remote_agent_state_changed")?.size ?? 0;

    expect(subsAfter).toBeLessThan(subsBefore);
  });
});
