import { renderHook, act } from "@testing-library/react";
import { useDelayedLoading } from "./use-delayed-loading";

describe("useDelayedLoading", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns false initially even when loading", () => {
    const { result } = renderHook(() => useDelayedLoading(true));
    expect(result.current).toBe(false);
  });

  it("returns false when not loading", () => {
    const { result } = renderHook(() => useDelayedLoading(false));
    expect(result.current).toBe(false);
  });

  it("returns true after delay when still loading", async () => {
    const { result } = renderHook(() => useDelayedLoading(true, 150));

    expect(result.current).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    expect(result.current).toBe(true);
  });

  it("returns true synchronously when delayMs is 0", () => {
    const { result } = renderHook(() => useDelayedLoading(true, 0));
    expect(result.current).toBe(true);
  });

  it("never shows loading when fetch resolves before delay", async () => {
    const { result, rerender } = renderHook(
      ({ isLoading }: { isLoading: boolean }) => useDelayedLoading(isLoading, 150),
      { initialProps: { isLoading: true } },
    );

    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current).toBe(false);

    rerender({ isLoading: false });

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe(false);
  });

  it("resets when loading stops and restarts", async () => {
    const { result, rerender } = renderHook(
      ({ isLoading }: { isLoading: boolean }) => useDelayedLoading(isLoading, 150),
      { initialProps: { isLoading: true } },
    );

    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current).toBe(true);

    rerender({ isLoading: false });
    expect(result.current).toBe(false);

    rerender({ isLoading: true });
    expect(result.current).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current).toBe(true);
  });
});
