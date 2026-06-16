import {
  DESKTOP_REVEAL_TIMER_FALLBACK_MS,
  scheduleDesktopReveal,
} from "./desktop-reveal";

describe("scheduleDesktopReveal", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses the post-paint requestAnimationFrame path when it is running", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const rafCallbacks: FrameRequestCallback[] = [];
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback): number => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      });

    scheduleDesktopReveal(callback);

    expect(rafSpy).toHaveBeenCalledTimes(1);
    expect(callback).not.toHaveBeenCalled();

    rafCallbacks.shift()?.(0);
    expect(callback).not.toHaveBeenCalled();
    expect(rafSpy).toHaveBeenCalledTimes(2);

    rafCallbacks.shift()?.(16);
    expect(callback).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(DESKTOP_REVEAL_TIMER_FALLBACK_MS);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("falls back to a timer when requestAnimationFrame is paused", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);

    scheduleDesktopReveal(callback);

    vi.advanceTimersByTime(DESKTOP_REVEAL_TIMER_FALLBACK_MS - 1);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
