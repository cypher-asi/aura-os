import { renderHook, act } from "@testing-library/react";
import { useDelayedEmpty } from "./use-delayed-empty";

describe("useDelayedEmpty", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns false initially when loading", () => {
    const { result } = renderHook(() => useDelayedEmpty(true, true));
    expect(result.current).toBe(false);
  });

  it("returns false initially when not empty", () => {
    const { result } = renderHook(() => useDelayedEmpty(false, false));
    expect(result.current).toBe(false);
  });

  it("returns true after delay when empty and not loading", async () => {
    const { result } = renderHook(() => useDelayedEmpty(true, false, 800));

    expect(result.current).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(result.current).toBe(true);
  });

  it("returns true synchronously when delayMs is 0", () => {
    const { result } = renderHook(() => useDelayedEmpty(true, false, 0));
    expect(result.current).toBe(true);
  });

  it("resets when data arrives during grace period", async () => {
    const { result, rerender } = renderHook(
      ({ isEmpty, loading }: { isEmpty: boolean; loading: boolean }) =>
        useDelayedEmpty(isEmpty, loading, 800),
      { initialProps: { isEmpty: true, loading: false } },
    );

    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current).toBe(false);

    rerender({ isEmpty: false, loading: false });

    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(result.current).toBe(false);
  });

  it("does not show empty when loading resumes", async () => {
    const { result, rerender } = renderHook(
      ({ isEmpty, loading }: { isEmpty: boolean; loading: boolean }) =>
        useDelayedEmpty(isEmpty, loading, 800),
      { initialProps: { isEmpty: true, loading: false } },
    );

    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current).toBe(false);

    rerender({ isEmpty: true, loading: true });

    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(result.current).toBe(false);
  });
});
