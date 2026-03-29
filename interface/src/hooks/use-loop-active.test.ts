import { renderHook, act, waitFor } from "@testing-library/react";
import { useLoopActive } from "./use-loop-active";

type SubscribeCallback = (event: Record<string, string>) => void;

const subscribeMap = new Map<string, Set<SubscribeCallback>>();

function subscribe(type: string, cb: SubscribeCallback): () => void {
  if (!subscribeMap.has(type)) subscribeMap.set(type, new Set());
  subscribeMap.get(type)!.add(cb);
  return () => subscribeMap.get(type)!.delete(cb);
}

vi.mock("../stores/event-store", () => ({
  useEventStore: (selector: (s: { subscribe: typeof subscribe }) => unknown) =>
    selector({ subscribe }),
}));

vi.mock("../api/client", () => ({
  api: {
    getLoopStatus: vi.fn().mockResolvedValue({ active_agent_instances: [] }),
  },
}));

import { api } from "../api/client";

describe("useLoopActive", () => {
  beforeEach(() => {
    subscribeMap.clear();
    vi.mocked(api.getLoopStatus).mockReset().mockResolvedValue({ active_agent_instances: [] });
  });

  it("returns false initially when no agents are active", async () => {
    const { result } = renderHook(() => useLoopActive("proj-1"));

    await waitFor(() => {
      expect(api.getLoopStatus).toHaveBeenCalled();
    });

    expect(result.current).toBe(false);
  });

  it("returns true when API reports active agents", async () => {
    vi.mocked(api.getLoopStatus).mockResolvedValue({
      active_agent_instances: [{ agent_instance_id: "a1" }],
    });

    const { result } = renderHook(() => useLoopActive("proj-1"));

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it("returns false when projectId is undefined", () => {
    const { result } = renderHook(() => useLoopActive(undefined));
    expect(result.current).toBe(false);
  });

  it("becomes true on loop_started event", async () => {
    const { result } = renderHook(() => useLoopActive("proj-1"));

    await waitFor(() => {
      expect(subscribeMap.has("loop_started")).toBe(true);
    });

    act(() => {
      subscribeMap.get("loop_started")!.forEach((cb) => cb({ project_id: "proj-1" }));
    });

    expect(result.current).toBe(true);
  });

  it("becomes false on loop_stopped event", async () => {
    vi.mocked(api.getLoopStatus).mockResolvedValue({
      active_agent_instances: [{ agent_instance_id: "a1" }],
    });

    const { result } = renderHook(() => useLoopActive("proj-1"));

    await waitFor(() => {
      expect(result.current).toBe(true);
    });

    act(() => {
      subscribeMap.get("loop_stopped")!.forEach((cb) => cb({ project_id: "proj-1" }));
    });

    expect(result.current).toBe(false);
  });

  it("ignores events for other projects", async () => {
    const { result } = renderHook(() => useLoopActive("proj-1"));

    await waitFor(() => {
      expect(subscribeMap.has("loop_started")).toBe(true);
    });

    act(() => {
      subscribeMap.get("loop_started")!.forEach((cb) => cb({ project_id: "proj-other" }));
    });

    expect(result.current).toBe(false);
  });

  it("cleans up subscriptions on unmount", async () => {
    const { unmount } = renderHook(() => useLoopActive("proj-1"));

    await waitFor(() => {
      expect(subscribeMap.has("loop_started")).toBe(true);
    });

    unmount();

    expect(subscribeMap.get("loop_started")!.size).toBe(0);
  });
});
