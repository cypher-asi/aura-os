import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-router-dom", () => ({
  useParams: () => ({ agentInstanceId: "agent-1" }),
}));

vi.mock("../stores/chat-ui-store", () => ({
  useChatUI: vi.fn(() => ({ selectedModel: "aura-gpt-4.1" })),
}));

vi.mock("../utils/storage", () => ({
  getLastAgent: vi.fn(() => "agent-1"),
}));

type SubscribeCallback = (event: { content: Record<string, unknown>; project_id?: string }) => void;
const subscribeMap = new Map<string, Set<SubscribeCallback>>();
let mockConnected = true;

vi.mock("../stores/event-store/index", () => ({
  useEventStore: (selector: (s: { subscribe: unknown; connected: boolean }) => unknown) =>
    selector({
      subscribe: (type: string, cb: SubscribeCallback) => {
        if (!subscribeMap.has(type)) subscribeMap.set(type, new Set());
        subscribeMap.get(type)!.add(cb);
        return () => subscribeMap.get(type)!.delete(cb);
      },
      connected: mockConnected,
    }),
}));

const mockGetLoopStatus = vi.fn();
const mockStartLoop = vi.fn();
const mockPauseLoop = vi.fn();
const mockStopLoop = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    getLoopStatus: (...args: unknown[]) => mockGetLoopStatus(...args),
    startLoop: (...args: unknown[]) => mockStartLoop(...args),
    pauseLoop: (...args: unknown[]) => mockPauseLoop(...args),
    stopLoop: (...args: unknown[]) => mockStopLoop(...args),
  },
}));

import { useLoopControl } from "./use-loop-control";

describe("useLoopControl", () => {
  beforeEach(() => {
    subscribeMap.clear();
    mockConnected = true;
    mockGetLoopStatus.mockReset().mockResolvedValue({ active_agent_instances: [], paused: false });
    mockStartLoop.mockReset().mockResolvedValue(undefined);
    mockPauseLoop.mockReset().mockResolvedValue(undefined);
    mockStopLoop.mockReset().mockResolvedValue(undefined);
  });

  it("returns initial state with no project", () => {
    const { result } = renderHook(() => useLoopControl(undefined));

    expect(result.current.loopRunning).toBe(false);
    expect(result.current.loopPaused).toBe(false);
    expect(result.current.error).toBe("");
    expect(mockGetLoopStatus).not.toHaveBeenCalled();
  });

  it("fetches loop status on mount", async () => {
    mockGetLoopStatus.mockResolvedValue({
      active_agent_instances: [{ id: "inst-1" }],
      paused: false,
    });

    const { result } = renderHook(() => useLoopControl("proj-1"));

    await waitFor(() => {
      expect(result.current.loopRunning).toBe(true);
    });
    expect(result.current.loopPaused).toBe(false);
    expect(mockGetLoopStatus).toHaveBeenCalledWith("proj-1");
  });

  it("shows paused state from fetched status", async () => {
    mockGetLoopStatus.mockResolvedValue({
      active_agent_instances: [{ id: "inst-1" }],
      paused: true,
    });

    const { result } = renderHook(() => useLoopControl("proj-1"));

    await waitFor(() => {
      expect(result.current.loopRunning).toBe(true);
      expect(result.current.loopPaused).toBe(true);
    });
  });

  it("handleStart calls API and updates state", async () => {
    const { result } = renderHook(() => useLoopControl("proj-1"));

    await act(async () => {
      await result.current.handleStart();
    });

    expect(mockStartLoop).toHaveBeenCalledWith("proj-1", "agent-1", "aura-gpt-4.1");
    expect(result.current.loopRunning).toBe(true);
    expect(result.current.loopPaused).toBe(false);
  });

  it("handleStart sets error on failure", async () => {
    mockStartLoop.mockRejectedValue(new Error("server down"));

    const { result } = renderHook(() => useLoopControl("proj-1"));

    await act(async () => {
      await result.current.handleStart();
    });

    expect(result.current.error).toBe("server down");
  });

  it("handlePause calls API and updates state", async () => {
    const { result } = renderHook(() => useLoopControl("proj-1"));

    await act(async () => {
      await result.current.handlePause();
    });

    expect(mockPauseLoop).toHaveBeenCalledWith("proj-1", "agent-1");
  });

  it("handleStop calls API and resets state", async () => {
    const { result } = renderHook(() => useLoopControl("proj-1"));

    await act(async () => {
      await result.current.handleStart();
    });

    await act(async () => {
      await result.current.handleStop();
    });

    expect(mockStopLoop).toHaveBeenCalledWith("proj-1", "agent-1");
  });

  it("does nothing on handleStart when projectId is undefined", async () => {
    const { result } = renderHook(() => useLoopControl(undefined));

    await act(async () => {
      await result.current.handleStart();
    });

    expect(mockStartLoop).not.toHaveBeenCalled();
  });

  it("reacts to LoopStarted event for matching project", () => {
    const { result } = renderHook(() => useLoopControl("proj-1"));

    act(() => {
      subscribeMap.get("loop_started")?.forEach((cb) =>
        cb({ content: {}, project_id: "proj-1" }),
      );
    });

    expect(result.current.loopRunning).toBe(true);
    expect(result.current.loopPaused).toBe(false);
  });

  it("ignores LoopStarted event for different project", () => {
    const { result } = renderHook(() => useLoopControl("proj-1"));

    act(() => {
      subscribeMap.get("loop_started")?.forEach((cb) =>
        cb({ content: {}, project_id: "proj-2" }),
      );
    });

    expect(result.current.loopRunning).toBe(false);
  });

  it("reacts to LoopPaused event", () => {
    const { result } = renderHook(() => useLoopControl("proj-1"));

    act(() => {
      subscribeMap.get("loop_started")?.forEach((cb) =>
        cb({ content: {}, project_id: "proj-1" }),
      );
    });

    act(() => {
      subscribeMap.get("loop_paused")?.forEach((cb) =>
        cb({ content: {}, project_id: "proj-1" }),
      );
    });

    expect(result.current.loopPaused).toBe(true);
  });

  it("reacts to LoopStopped event", () => {
    const { result } = renderHook(() => useLoopControl("proj-1"));

    act(() => {
      subscribeMap.get("loop_started")?.forEach((cb) =>
        cb({ content: {}, project_id: "proj-1" }),
      );
    });

    act(() => {
      subscribeMap.get("loop_stopped")?.forEach((cb) =>
        cb({ content: {}, project_id: "proj-1" }),
      );
    });

    expect(result.current.loopRunning).toBe(false);
  });

  it("reacts to LoopFinished event", () => {
    const { result } = renderHook(() => useLoopControl("proj-1"));

    act(() => {
      subscribeMap.get("loop_started")?.forEach((cb) =>
        cb({ content: {}, project_id: "proj-1" }),
      );
    });

    act(() => {
      subscribeMap.get("loop_finished")?.forEach((cb) =>
        cb({ content: {}, project_id: "proj-1" }),
      );
    });

    expect(result.current.loopRunning).toBe(false);
    expect(result.current.loopPaused).toBe(false);
  });
});
