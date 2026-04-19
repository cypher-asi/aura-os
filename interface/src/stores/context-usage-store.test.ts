import { beforeEach, describe, expect, it } from "vitest";
import { useContextUsageStore } from "./context-usage-store";

describe("useContextUsageStore", () => {
  beforeEach(() => {
    useContextUsageStore.setState({
      usageByStreamKey: {},
      resetPendingByStreamKey: {},
    });
  });

  it("stores and retrieves a per-streamKey value", () => {
    useContextUsageStore.getState().setContextUtilization("k1", 0.42);
    const entry = useContextUsageStore.getState().usageByStreamKey.k1;
    expect(entry?.utilization).toBeCloseTo(0.42);
    expect(entry?.estimatedTokens).toBeUndefined();
  });

  it("stores an optional estimatedTokens alongside utilization", () => {
    useContextUsageStore.getState().setContextUtilization("k1", 0.42, 12_345);
    const entry = useContextUsageStore.getState().usageByStreamKey.k1;
    expect(entry?.utilization).toBeCloseTo(0.42);
    expect(entry?.estimatedTokens).toBe(12_345);
  });

  it("ignores non-finite or negative estimatedTokens", () => {
    const s = useContextUsageStore.getState();
    s.setContextUtilization("k1", 0.1, Number.NaN);
    s.setContextUtilization("k2", 0.2, -5);
    const latest = useContextUsageStore.getState();
    expect(latest.usageByStreamKey.k1?.estimatedTokens).toBeUndefined();
    expect(latest.usageByStreamKey.k2?.estimatedTokens).toBeUndefined();
  });

  it("clears a value without affecting reset-pending sentinel", () => {
    const s = useContextUsageStore.getState();
    s.setContextUtilization("k1", 0.42);
    s.markResetPending("k1");
    s.clearContextUtilization("k1");

    const latest = useContextUsageStore.getState();
    expect(latest.usageByStreamKey.k1).toBeUndefined();
    expect(latest.isResetPending("k1")).toBe(true);
  });

  it("markResetPending sets the sentinel; isResetPending reports it", () => {
    const s = useContextUsageStore.getState();
    expect(s.isResetPending("k1")).toBe(false);
    s.markResetPending("k1");
    expect(useContextUsageStore.getState().isResetPending("k1")).toBe(true);
  });

  it("setContextUtilization clears the reset-pending sentinel for that key", () => {
    const s = useContextUsageStore.getState();
    s.markResetPending("k1");
    s.markResetPending("k2");
    s.setContextUtilization("k1", 0.1);

    const latest = useContextUsageStore.getState();
    expect(latest.isResetPending("k1")).toBe(false);
    expect(latest.isResetPending("k2")).toBe(true);
  });
});
