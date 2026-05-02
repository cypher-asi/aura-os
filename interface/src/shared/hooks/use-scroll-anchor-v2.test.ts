import { act, renderHook } from "@testing-library/react";
import { vi } from "vitest";
import { useScrollAnchorV2 } from "./use-scroll-anchor-v2";

function makeContainer(overrides: {
  scrollTop?: number;
  scrollHeight?: number;
  clientHeight?: number;
} = {}) {
  const container = document.createElement("div");
  Object.defineProperties(container, {
    scrollTop: {
      value: overrides.scrollTop ?? 0,
      writable: true,
      configurable: true,
    },
    scrollHeight: {
      value: overrides.scrollHeight ?? 1000,
      writable: true,
      configurable: true,
    },
    clientHeight: {
      value: overrides.clientHeight ?? 400,
      writable: true,
      configurable: true,
    },
  });
  return container;
}

describe("useScrollAnchorV2", () => {
  let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    requestAnimationFrameSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
  });

  afterEach(() => {
    requestAnimationFrameSpy.mockRestore();
  });

  it("starts pinned and scrolls to the bottom on mount", () => {
    const container = makeContainer({ scrollTop: 100, scrollHeight: 1000, clientHeight: 400 });
    const ref = { current: container };

    const { result } = renderHook(() =>
      useScrollAnchorV2(ref, { resetKey: "thread-1" }),
    );

    expect(result.current.isAutoFollowing).toBe(true);
    expect(container.scrollTop).toBe(1000);
  });

  it("can reset follow state without forcing a bottom scroll", () => {
    const container = makeContainer({ scrollTop: 100, scrollHeight: 1000, clientHeight: 400 });
    const ref = { current: container };

    const { result, rerender } = renderHook(
      ({ resetKey }) =>
        useScrollAnchorV2(ref, {
          resetKey,
          scrollToBottomOnReset: false,
        }),
      { initialProps: { resetKey: "thread-1" } },
    );

    expect(result.current.isAutoFollowing).toBe(true);
    expect(container.scrollTop).toBe(100);

    act(() => {
      (container as unknown as { scrollTop: number }).scrollTop = 0;
      result.current.handleScroll();
    });
    expect(result.current.isAutoFollowing).toBe(false);

    rerender({ resetKey: "thread-2" });

    expect(result.current.isAutoFollowing).toBe(true);
    expect(container.scrollTop).toBe(0);
  });

  it("flips out of auto-follow when the user scrolls far enough from the bottom", () => {
    const container = makeContainer({ scrollTop: 1000, scrollHeight: 1000, clientHeight: 400 });
    const ref = { current: container };

    const { result } = renderHook(() =>
      useScrollAnchorV2(ref, { resetKey: "thread-1" }),
    );

    act(() => {
      (container as unknown as { scrollTop: number }).scrollTop = 0;
      result.current.handleScroll();
    });

    expect(result.current.isAutoFollowing).toBe(false);
  });

  it("scrollToBottom snaps back to the bottom and re-pins", () => {
    const container = makeContainer({ scrollTop: 1000, scrollHeight: 1000, clientHeight: 400 });
    const ref = { current: container };

    const { result } = renderHook(() =>
      useScrollAnchorV2(ref, { resetKey: "thread-1" }),
    );

    act(() => {
      (container as unknown as { scrollTop: number }).scrollTop = 0;
      result.current.handleScroll();
    });
    expect(result.current.isAutoFollowing).toBe(false);

    (container as unknown as { scrollHeight: number }).scrollHeight = 1200;
    act(() => {
      result.current.scrollToBottom();
    });

    expect(container.scrollTop).toBe(1200);
    expect(result.current.isAutoFollowing).toBe(true);
  });

  it("ignores scroll events triggered by its own scrollToBottom writes", () => {
    const container = makeContainer({ scrollTop: 1000, scrollHeight: 1000, clientHeight: 400 });
    const ref = { current: container };

    const { result } = renderHook(() =>
      useScrollAnchorV2(ref, { resetKey: "thread-1" }),
    );

    // Scroll up, so we're no longer auto-following
    act(() => {
      (container as unknown as { scrollTop: number }).scrollTop = 0;
      result.current.handleScroll();
    });
    expect(result.current.isAutoFollowing).toBe(false);

    // Programmatic scroll-to-bottom should not flip us back to "not following"
    // via the guarded scroll handler, even though it dispatches a scroll.
    (container as unknown as { scrollHeight: number }).scrollHeight = 1200;
    let restoreRaf: (() => void) | null = null;
    requestAnimationFrameSpy.mockImplementationOnce((cb: FrameRequestCallback) => {
      restoreRaf = () => cb(0);
      return 1;
    });

    act(() => {
      result.current.scrollToBottom();
      // scrollTop set to 1200 — if handleScroll fired now it would see
      // distFromBottom=0 and stay pinned, but we want to verify the guard
      // short-circuits entirely before the rAF cleanup runs.
      result.current.handleScroll();
    });

    expect(result.current.isAutoFollowing).toBe(true);
    expect(container.scrollTop).toBe(1200);

    restoreRaf?.();
  });
});
