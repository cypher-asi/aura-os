import { renderHook, act } from "@testing-library/react";
import { useCheckoutPolling } from "./use-checkout-polling";

vi.mock("../api/client", () => ({
  api: {
    orgs: {
      getCreditBalance: vi.fn(),
    },
  },
}));

import { api } from "../api/client";

const mockGetBalance = vi.mocked(api.orgs.getCreditBalance);

const balanceResponse = (cents: number) => ({
  balance_cents: cents,
  plan: "free",
  balance_formatted: `$${(cents / 100).toFixed(2)}`,
});

describe("useCheckoutPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetBalance.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with idle status", () => {
    const { result } = renderHook(() => useCheckoutPolling("org-1"));

    expect(result.current.status).toBe("idle");
    expect(result.current.settledBalance).toBeNull();
  });

  it("transitions to polling on startPolling", () => {
    mockGetBalance.mockResolvedValue(balanceResponse(100));

    const { result } = renderHook(() => useCheckoutPolling("org-1"));

    act(() => {
      result.current.startPolling(100);
    });

    expect(result.current.status).toBe("polling");
  });

  it("transitions to success when balance increases after settle timeout", async () => {
    mockGetBalance.mockResolvedValue(balanceResponse(200));

    const { result } = renderHook(() => useCheckoutPolling("org-1"));

    await act(async () => {
      result.current.startPolling(100);
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(result.current.status).toBe("success");
    expect(result.current.settledBalance).toBeTruthy();
    expect(result.current.settledBalance!.balance_cents).toBe(200);
  });

  it("times out after POLL_TIMEOUT_MS", async () => {
    mockGetBalance.mockResolvedValue(balanceResponse(100));

    const { result } = renderHook(() => useCheckoutPolling("org-1"));

    act(() => {
      result.current.startPolling(100);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    expect(result.current.status).toBe("timeout");
  });

  it("resets to idle", async () => {
    mockGetBalance.mockResolvedValue(balanceResponse(200));

    const { result } = renderHook(() => useCheckoutPolling("org-1"));

    await act(async () => {
      result.current.startPolling(100);
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.settledBalance).toBeNull();
  });

  it("does nothing when orgId is undefined", () => {
    const { result } = renderHook(() => useCheckoutPolling(undefined));

    act(() => {
      result.current.startPolling(100);
    });

    expect(result.current.status).toBe("idle");
  });
});
