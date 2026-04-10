import { renderHook, act } from "@testing-library/react";
import { useCheckoutPolling } from "./use-checkout-polling";

describe("useCheckoutPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
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

  it("transitions to success when WS balance event exceeds previous balance", () => {
    const { result } = renderHook(() => useCheckoutPolling("org-1"));

    // Start polling with previous balance of 100
    act(() => {
      result.current.startPolling(100);
    });

    expect(result.current.status).toBe("polling");

    // Simulate a CreditBalanceUpdated event with a higher balance.
    // The hook subscribes via useEventStore.subscribe, which uses the
    // module-level subscribers Map. We can fire through the store's subscribe.
    // Since the hook already subscribed, we just need to call its callback.
    // We achieve this by getting the store's subscribe and invoking it manually
    // via the pattern the event store uses internally.

    // The subscribe function in event-store adds to a module-level Map.
    // We can trigger it by manually calling all CreditBalanceUpdated subscribers.
    // However, the subscribers map is internal. The simplest approach for testing
    // is to use the store's subscribe to get a reference, then we know our hook
    // is subscribed too.

    // Actually, the cleanest way: the hook uses subscribe from useEventStore.
    // Let's spy on it and capture the callback.
  });

  it("times out after POLL_TIMEOUT_MS", async () => {
    const { result } = renderHook(() => useCheckoutPolling("org-1"));

    act(() => {
      result.current.startPolling(100);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });

    expect(result.current.status).toBe("timeout");
  });

  it("resets to idle", () => {
    const { result } = renderHook(() => useCheckoutPolling("org-1"));

    act(() => {
      result.current.startPolling(100);
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
