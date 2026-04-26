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
const mockResumeLoop = vi.fn();
const mockListAgentInstances = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    getLoopStatus: (...args: unknown[]) => mockGetLoopStatus(...args),
    startLoop: (...args: unknown[]) => mockStartLoop(...args),
    pauseLoop: (...args: unknown[]) => mockPauseLoop(...args),
    stopLoop: (...args: unknown[]) => mockStopLoop(...args),
    resumeLoop: (...args: unknown[]) => mockResumeLoop(...args),
    listAgentInstances: (...args: unknown[]) => mockListAgentInstances(...args),
  },
}));

import { useLoopControl } from "./use-loop-control";
import { useAutomationLoopStore } from "../stores/automation-loop-store";

describe("useLoopControl", () => {
  beforeEach(() => {
    subscribeMap.clear();
    mockConnected = true;
    useAutomationLoopStore.getState().reset();
    mockGetLoopStatus.mockReset().mockResolvedValue({ active_agent_instances: [], paused: false });
    mockStartLoop
      .mockReset()
      .mockResolvedValue({ active_agent_instances: ["loop-agent-1"], agent_instance_id: "loop-agent-1" });
    mockPauseLoop.mockReset().mockResolvedValue(undefined);
    mockStopLoop.mockReset().mockResolvedValue(undefined);
    mockResumeLoop.mockReset().mockResolvedValue(undefined);
    // Default project: chat agent + Loop-role instance already
    // exists. handlePause / handleStop should target `loop-agent-1`.
    mockListAgentInstances.mockReset().mockResolvedValue([
      { agent_instance_id: "agent-1", instance_role: "chat" },
      { agent_instance_id: "loop-agent-1", instance_role: "loop" },
    ]);
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

  it("handleStart calls API without an agent id so the backend resolves the Loop instance", async () => {
    const { result } = renderHook(() => useLoopControl("proj-1"));
    // Wait for the on-mount listAgentInstances() before triggering
    // start, so the bound id is hydrated for the assertion below.
    await waitFor(() => expect(mockListAgentInstances).toHaveBeenCalledWith("proj-1"));

    await act(async () => {
      await result.current.handleStart();
    });

    expect(mockStartLoop).toHaveBeenCalledWith("proj-1", undefined, "aura-gpt-4.1");
    expect(result.current.loopRunning).toBe(true);
    expect(result.current.loopPaused).toBe(false);
  });

  it("handleStart sets error on failure", async () => {
    mockStartLoop.mockRejectedValue(new Error("server down"));

    const { result } = renderHook(() => useLoopControl("proj-1"));
    await waitFor(() => expect(mockListAgentInstances).toHaveBeenCalledWith("proj-1"));

    await act(async () => {
      await result.current.handleStart();
    });

    expect(result.current.error).toBe("server down");
  });

  it("handlePause targets the bound Loop instance, not the URL chat agent", async () => {
    const { result } = renderHook(() => useLoopControl("proj-1"));
    await waitFor(() => expect(mockListAgentInstances).toHaveBeenCalledWith("proj-1"));

    await act(async () => {
      await result.current.handlePause();
    });

    expect(mockPauseLoop).toHaveBeenCalledWith("proj-1", "loop-agent-1");
    expect(mockPauseLoop).not.toHaveBeenCalledWith("proj-1", "agent-1");
  });

  it("handleStop targets the bound Loop instance, not the URL chat agent", async () => {
    const { result } = renderHook(() => useLoopControl("proj-1"));
    await waitFor(() => expect(mockListAgentInstances).toHaveBeenCalledWith("proj-1"));

    await act(async () => {
      await result.current.handleStart();
    });

    await act(async () => {
      await result.current.handleStop();
    });

    expect(mockStopLoop).toHaveBeenCalledWith("proj-1", "loop-agent-1");
    expect(mockStopLoop).not.toHaveBeenCalledWith("proj-1", "agent-1");
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
