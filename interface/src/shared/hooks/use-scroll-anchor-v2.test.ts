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

  it("flips out of auto-follow synchronously on a wheel-up event", () => {
    const container = makeContainer({ scrollTop: 1000, scrollHeight: 1000, clientHeight: 400 });
    const ref = { current: container };

    const { result } = renderHook(() =>
      useScrollAnchorV2(ref, { resetKey: "thread-1" }),
    );

    expect(result.current.isAutoFollowing).toBe(true);
    expect(result.current.getUserUnpinnedAt()).toBe(0);

    act(() => {
      container.dispatchEvent(new WheelEvent("wheel", { deltaY: -10 }));
    });

    expect(result.current.isAutoFollowing).toBe(false);
    expect(result.current.getUserUnpinnedAt()).toBeGreaterThan(0);
  });

  it("flips out of auto-follow on a downward swipe (touch scrolling content up)", () => {
    const container = makeContainer({ scrollTop: 1000, scrollHeight: 1000, clientHeight: 400 });
    const ref = { current: container };

    const { result } = renderHook(() =>
      useScrollAnchorV2(ref, { resetKey: "thread-1" }),
    );

    act(() => {
      const start = new Event("touchstart") as TouchEvent;
      Object.defineProperty(start, "touches", {
        value: [{ clientY: 100 }],
        configurable: true,
      });
      container.dispatchEvent(start);
      const move = new Event("touchmove") as TouchEvent;
      Object.defineProperty(move, "touches", {
        value: [{ clientY: 200 }],
        configurable: true,
      });
      container.dispatchEvent(move);
    });

    expect(result.current.isAutoFollowing).toBe(false);
    expect(result.current.getUserUnpinnedAt()).toBeGreaterThan(0);
  });

  it("flips out of auto-follow on ArrowUp / PageUp / Home keys", () => {
    const container = makeContainer({ scrollTop: 1000, scrollHeight: 1000, clientHeight: 400 });
    const ref = { current: container };

    const { result } = renderHook(() =>
      useScrollAnchorV2(ref, { resetKey: "thread-1" }),
    );

    for (const key of ["ArrowUp", "PageUp", "Home"]) {
      act(() => {
        result.current.scrollToBottom();
      });
      expect(result.current.isAutoFollowing).toBe(true);
      act(() => {
        container.dispatchEvent(new KeyboardEvent("keydown", { key }));
      });
      expect(result.current.isAutoFollowing).toBe(false);
      expect(result.current.getUserUnpinnedAt()).toBeGreaterThan(0);
    }
  });

  it("does NOT flip on wheel-down (user scrolling toward the bottom)", () => {
    const container = makeContainer({ scrollTop: 1000, scrollHeight: 1000, clientHeight: 400 });
    const ref = { current: container };

    const { result } = renderHook(() =>
      useScrollAnchorV2(ref, { resetKey: "thread-1" }),
    );

    act(() => {
      container.dispatchEvent(new WheelEvent("wheel", { deltaY: 50 }));
    });

    expect(result.current.isAutoFollowing).toBe(true);
    expect(result.current.getUserUnpinnedAt()).toBe(0);
  });

  it("unpins on a scrollbar-drag upward (scroll event only, no wheel/touch/key)", () => {
    // Regression: dragging the scrollbar up emits only a `scroll` event. While
    // still inside the exit band, follow stayed engaged and the streaming
    // tail-pin snapped the viewport back to the bottom every token — the chat
    // "fought" the drag. An upward scrollTop delta must now count as intent.
    // scrollHeight=2000, clientHeight=400, scrollTop=1600 → at bottom.
    const container = makeContainer({ scrollTop: 1600, scrollHeight: 2000, clientHeight: 400 });
    const ref = { current: container };

    const { result } = renderHook(() =>
      useScrollAnchorV2(ref, { resetKey: "thread-1", scrollToBottomOnReset: false }),
    );

    expect(result.current.isAutoFollowing).toBe(true);

    // User drags the scrollbar up ~50px, well inside the exit band.
    act(() => {
      (container as unknown as { scrollTop: number }).scrollTop = 1550;
      result.current.handleScroll();
    });

    expect(result.current.isAutoFollowing).toBe(false);
    expect(result.current.getUserUnpinnedAt()).toBeGreaterThan(0);
  });

  it("does NOT unpin on a downward scroll toward the bottom", () => {
    const container = makeContainer({ scrollTop: 1550, scrollHeight: 2000, clientHeight: 400 });
    const ref = { current: container };

    const { result } = renderHook(() =>
      useScrollAnchorV2(ref, { resetKey: "thread-1", scrollToBottomOnReset: false }),
    );

    act(() => {
      (container as unknown as { scrollTop: number }).scrollTop = 1580;
      result.current.handleScroll();
    });

    expect(result.current.isAutoFollowing).toBe(true);
    expect(result.current.getUserUnpinnedAt()).toBe(0);
  });

  it("clears userUnpinnedAt when scrollToBottom is called", () => {
    const container = makeContainer({ scrollTop: 1000, scrollHeight: 1000, clientHeight: 400 });
    const ref = { current: container };

    const { result } = renderHook(() =>
      useScrollAnchorV2(ref, { resetKey: "thread-1" }),
    );

    act(() => {
      container.dispatchEvent(new WheelEvent("wheel", { deltaY: -10 }));
    });
    expect(result.current.getUserUnpinnedAt()).toBeGreaterThan(0);

    act(() => {
      result.current.scrollToBottom();
    });

    expect(result.current.getUserUnpinnedAt()).toBe(0);
    expect(result.current.isAutoFollowing).toBe(true);
  });

  it("keeps the posting session unpinned even if the user reaches the bottom", () => {
    const container = makeContainer({ scrollTop: 1000, scrollHeight: 1000, clientHeight: 400 });
    const ref = { current: container };

    const { result } = renderHook(() =>
      useScrollAnchorV2(ref, { resetKey: "thread-1" }),
    );

    act(() => {
      container.dispatchEvent(new WheelEvent("wheel", { deltaY: -10 }));
    });
    expect(result.current.getUserUnpinnedAt()).toBeGreaterThan(0);
    expect(result.current.isAutoFollowing).toBe(false);

    act(() => {
      (container as unknown as { scrollTop: number }).scrollTop = 1000;
      result.current.handleScroll();
    });

    expect(result.current.isAutoFollowing).toBe(false);
    expect(result.current.getUserUnpinnedAt()).toBeGreaterThan(0);

    act(() => {
      result.current.scrollToBottom();
    });

    expect(result.current.isAutoFollowing).toBe(true);
    expect(result.current.getUserUnpinnedAt()).toBe(0);
  });

  it("keeps the user unpinned when the resulting scroll lands inside the old enter-follow band", () => {
    // Regression: a wheel-up that only moves the viewport ~50px (well
    // inside the 180px ENTER_FOLLOW_THRESHOLD_PX) used to immediately
    // re-pin the user via handleScroll, which then re-fired the
    // ChatMessageList tail-pin layout effect and snapped the viewport
    // back to the bottom — making the chat "fight" the user.
    // scrollHeight=2000, clientHeight=400, scrollTop=1600 → at bottom.
    const container = makeContainer({ scrollTop: 1600, scrollHeight: 2000, clientHeight: 400 });
    const ref = { current: container };

    const { result } = renderHook(() =>
      useScrollAnchorV2(ref, { resetKey: "thread-1", scrollToBottomOnReset: false }),
    );

    act(() => {
      container.dispatchEvent(new WheelEvent("wheel", { deltaY: -10 }));
    });

    // Browser updates scrollTop and dispatches a scroll event. The new
    // distFromBottom is 50, which is inside the legacy enter-band (180).
    act(() => {
      (container as unknown as { scrollTop: number }).scrollTop = 1550;
      result.current.handleScroll();
    });

    expect(result.current.isAutoFollowing).toBe(false);
    expect(result.current.getUserUnpinnedAt()).toBeGreaterThan(0);
  });

  it("stays unpinned through repeated scroll ticks until reaching the very bottom", () => {
    const container = makeContainer({ scrollTop: 1600, scrollHeight: 2000, clientHeight: 400 });
    const ref = { current: container };

    const { result } = renderHook(() =>
      useScrollAnchorV2(ref, { resetKey: "thread-1", scrollToBottomOnReset: false }),
    );

    act(() => {
      container.dispatchEvent(new WheelEvent("wheel", { deltaY: -10 }));
    });

    for (const scrollTop of [1570, 1550, 1590, 1598]) {
      act(() => {
        (container as unknown as { scrollTop: number }).scrollTop = scrollTop;
        result.current.handleScroll();
      });
      expect(result.current.isAutoFollowing).toBe(false);
      expect(result.current.getUserUnpinnedAt()).toBeGreaterThan(0);
    }

    // Landing at the true bottom does not re-arm follow during the same
    // posting session.
    act(() => {
      (container as unknown as { scrollTop: number }).scrollTop = 1600;
      result.current.handleScroll();
    });
    expect(result.current.isAutoFollowing).toBe(false);
    expect(result.current.getUserUnpinnedAt()).toBeGreaterThan(0);

    // The next send uses this imperative path to begin a fresh posting
    // session with auto-follow enabled again.
    act(() => {
      result.current.scrollToBottom();
    });
    expect(result.current.isAutoFollowing).toBe(true);
    expect(result.current.getUserUnpinnedAt()).toBe(0);
  });

  it("clears userUnpinnedAt on resetKey change", () => {
    const container = makeContainer({ scrollTop: 1000, scrollHeight: 1000, clientHeight: 400 });
    const ref = { current: container };

    const { result, rerender } = renderHook(
      ({ resetKey }) =>
        useScrollAnchorV2(ref, { resetKey, scrollToBottomOnReset: false }),
      { initialProps: { resetKey: "thread-1" } },
    );

    act(() => {
      container.dispatchEvent(new WheelEvent("wheel", { deltaY: -10 }));
    });
    expect(result.current.getUserUnpinnedAt()).toBeGreaterThan(0);

    rerender({ resetKey: "thread-2" });

    expect(result.current.getUserUnpinnedAt()).toBe(0);
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
