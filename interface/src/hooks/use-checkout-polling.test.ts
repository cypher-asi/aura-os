import { renderHook, act } from "@testing-library/react";
import { useCheckoutPolling } from "./use-checkout-polling";

const mockGetCreditBalance = vi.fn();
const listeners = new Map<string, Set<(event: { content: { balance_cents?: number; balance_formatted?: string } }) => void>>();
const mockSubscribe = vi.fn((type: string, callback: (event: { content: { balance_cents?: number; balance_formatted?: string } }) => void) => {
  let callbacks = listeners.get(type);
  if (!callbacks) {
    callbacks = new Set();
    listeners.set(type, callbacks);
  }
  callbacks.add(callback);
  return () => callbacks?.delete(callback);
});

vi.mock("../api/client", () => ({
  api: {
    orgs: {
      getCreditBalance: (...args: unknown[]) => mockGetCreditBalance(...args),
    },
  },
}));

vi.mock("../stores/event-store/index", () => {
  const store = {
    subscribe: (...args: unknown[]) => mockSubscribe(...args),
  };
  return {
    useEventStore: (selector: (s: typeof store) => unknown) => selector(store),
  };
});

function emitBalanceUpdate(balance_cents: number, balance_formatted = `$${(balance_cents / 100).toFixed(2)}`) {
  listeners.get("credit_balance_updated")?.forEach((callback) => {
    callback({ content: { balance_cents, balance_formatted } });
  });
}

describe("useCheckoutPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    listeners.clear();
    mockSubscribe.mockClear();
    mockGetCreditBalance.mockReset();
    mockGetCreditBalance.mockResolvedValue({
      balance_cents: 100,
      balance_formatted: "$1.00",
      plan: "free",
    });
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
    const { result } = renderHook(() => useCheckoutPolling("org-1"));

    act(() => {
      result.current.startPolling(100);
    });

    expect(result.current.status).toBe("polling");
  });

  it("transitions to success when a balance event exceeds the previous balance", () => {
    const { result } = renderHook(() => useCheckoutPolling("org-1"));

    act(() => {
      result.current.startPolling(100);
    });

    act(() => {
      emitBalanceUpdate(250, "$2.50");
    });

    expect(result.current.status).toBe("success");
    expect(result.current.settledBalance).toEqual({
      balance_cents: 250,
      balance_formatted: "$2.50",
      plan: "",
    });
  });

  it("falls back to HTTP balance checks when a realtime event is missed", async () => {
    mockGetCreditBalance.mockResolvedValue({
      balance_cents: 250,
      balance_formatted: "$2.50",
      plan: "free",
    });

    const { result } = renderHook(() => useCheckoutPolling("org-1"));

    act(() => {
      result.current.startPolling(100);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(mockGetCreditBalance).toHaveBeenCalledWith("org-1");
    expect(result.current.status).toBe("success");
    expect(result.current.settledBalance).toEqual({
      balance_cents: 250,
      balance_formatted: "$2.50",
      plan: "",
    });
  });

  it("times out after five minutes when the balance never increases", async () => {
    const { result } = renderHook(() => useCheckoutPolling("org-1"));

    act(() => {
      result.current.startPolling(100);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);
    });

    expect(result.current.status).toBe("timeout");
  });

  it("resets to idle and clears pending watchers", async () => {
    const { result } = renderHook(() => useCheckoutPolling("org-1"));

    act(() => {
      result.current.startPolling(100);
      result.current.reset();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.settledBalance).toBeNull();
    expect(mockGetCreditBalance).not.toHaveBeenCalled();
  });

  it("does nothing when orgId is undefined", async () => {
    const { result } = renderHook(() => useCheckoutPolling(undefined));

    act(() => {
      result.current.startPolling(100);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(result.current.status).toBe("idle");
    expect(mockGetCreditBalance).not.toHaveBeenCalled();
  });
});
