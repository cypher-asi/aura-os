import { renderHook, waitFor, act } from "@testing-library/react";

type SubscribeCallback = (event: { content: Record<string, unknown> }) => void;
const subscribeMap = new Map<string, Set<SubscribeCallback>>();

// Stable `subscribe` reference (mirrors the real zustand selector) so the
// polling effect's deps don't churn and re-run the effect on every
// re-render — otherwise each setState would spawn an extra poll loop and
// break cadence assertions.
const stableSubscribe = (type: string, cb: SubscribeCallback) => {
  if (!subscribeMap.has(type)) subscribeMap.set(type, new Set());
  subscribeMap.get(type)!.add(cb);
  return () => subscribeMap.get(type)!.delete(cb);
};

vi.mock("../stores/event-store/index", () => ({
  useEventStore: (selector: (s: { subscribe: unknown }) => unknown) =>
    selector({ subscribe: stableSubscribe }),
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

  it("backs off to the settled interval once the VM is terminal", async () => {
    vi.useFakeTimers();
    try {
      mockGetRemoteAgentState.mockResolvedValue({
        state: "error",
        uptime_seconds: 0,
        active_sessions: 0,
        error_message: "pod unschedulable",
      });

      renderHook(() => useRemoteAgentState("agent-term"));

      // First poll fires immediately.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mockGetRemoteAgentState).toHaveBeenCalledTimes(1);

      // At the normal 30s cadence it must NOT re-poll — a terminal state
      // backs off to the 60s settled interval.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(mockGetRemoteAgentState).toHaveBeenCalledTimes(1);

      // The settled poll fires at 60s.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(mockGetRemoteAgentState).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("backs off after consecutive poll failures (e.g. repeated 502s)", async () => {
    vi.useFakeTimers();
    try {
      mockGetRemoteAgentState.mockRejectedValue(new Error("502 Bad Gateway"));

      renderHook(() => useRemoteAgentState("agent-fail"));

      // 3 failures (immediate + two 30s ticks) trips the backoff.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(mockGetRemoteAgentState).toHaveBeenCalledTimes(3);

      // Now settled: the next poll is 60s out, not 30s.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(mockGetRemoteAgentState).toHaveBeenCalledTimes(3);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(mockGetRemoteAgentState).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
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
