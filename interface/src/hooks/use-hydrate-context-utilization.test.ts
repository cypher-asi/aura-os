import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./stream/hooks", () => ({
  useIsStreaming: vi.fn(() => false),
}));

import { useIsStreaming } from "./stream/hooks";
import { useContextUsageStore } from "../stores/context-usage-store";
import { useHydrateContextUtilization } from "./use-hydrate-context-utilization";

describe("useHydrateContextUtilization", () => {
  beforeEach(() => {
    useContextUsageStore.setState({
      usageByStreamKey: {},
      resetPendingByStreamKey: {},
    });
    vi.mocked(useIsStreaming).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("seeds the store with the latest session's context utilization on mount", async () => {
    const fetcher = vi.fn().mockResolvedValue({ context_utilization: 0.42 });

    renderHook(() => useHydrateContextUtilization("stream-1", fetcher, "agent-1"));

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(useContextUsageStore.getState().usageByStreamKey["stream-1"]).toBeCloseTo(0.42);
    });
  });

  it("skips hydration when the reset sentinel is pending", async () => {
    useContextUsageStore.getState().markResetPending("stream-1");
    const fetcher = vi.fn().mockResolvedValue({ context_utilization: 0.9 });

    renderHook(() => useHydrateContextUtilization("stream-1", fetcher, "agent-1"));

    await new Promise((r) => setTimeout(r, 10));
    expect(fetcher).not.toHaveBeenCalled();
    expect(useContextUsageStore.getState().usageByStreamKey["stream-1"]).toBeUndefined();
  });

  it("skips hydration when the store already has a value", async () => {
    useContextUsageStore.getState().setContextUtilization("stream-1", 0.33);
    const fetcher = vi.fn().mockResolvedValue({ context_utilization: 0.9 });

    renderHook(() => useHydrateContextUtilization("stream-1", fetcher, "agent-1"));

    await new Promise((r) => setTimeout(r, 10));
    expect(fetcher).not.toHaveBeenCalled();
    expect(useContextUsageStore.getState().usageByStreamKey["stream-1"]).toBeCloseTo(0.33);
  });

  it("skips hydration when a stream is active", async () => {
    vi.mocked(useIsStreaming).mockReturnValue(true);
    const fetcher = vi.fn().mockResolvedValue({ context_utilization: 0.42 });

    renderHook(() => useHydrateContextUtilization("stream-1", fetcher, "agent-1"));

    await new Promise((r) => setTimeout(r, 10));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not write a zero value to the store", async () => {
    const fetcher = vi.fn().mockResolvedValue({ context_utilization: 0 });

    renderHook(() => useHydrateContextUtilization("stream-1", fetcher, "agent-1"));

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
    expect(useContextUsageStore.getState().usageByStreamKey["stream-1"]).toBeUndefined();
  });

  it("does not seed if reset was marked after fetch started but before it resolved", async () => {
    let resolveFetch: ((v: { context_utilization: number }) => void) | null = null;
    const fetcher = vi.fn(
      () =>
        new Promise<{ context_utilization: number }>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    renderHook(() => useHydrateContextUtilization("stream-1", fetcher, "agent-1"));

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    useContextUsageStore.getState().markResetPending("stream-1");
    resolveFetch?.({ context_utilization: 0.77 });

    await new Promise((r) => setTimeout(r, 10));
    expect(useContextUsageStore.getState().usageByStreamKey["stream-1"]).toBeUndefined();
    expect(useContextUsageStore.getState().isResetPending("stream-1")).toBe(true);
  });

  it("does nothing when resetKey is undefined", async () => {
    const fetcher = vi.fn();

    renderHook(() => useHydrateContextUtilization("stream-1", fetcher, undefined));

    await new Promise((r) => setTimeout(r, 10));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does nothing when fetcher is undefined", async () => {
    renderHook(() => useHydrateContextUtilization("stream-1", undefined, "agent-1"));

    await new Promise((r) => setTimeout(r, 10));
    expect(useContextUsageStore.getState().usageByStreamKey["stream-1"]).toBeUndefined();
  });
});
