import { renderHook, act } from "@testing-library/react";
import { useAutoScroll } from "./use-auto-scroll";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

class MockMutationObserver {
  callback: MutationCallback;
  static instances: MockMutationObserver[] = [];
  constructor(callback: MutationCallback) {
    this.callback = callback;
    MockMutationObserver.instances.push(this);
  }
  observe = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => [] as MutationRecord[]);
  trigger(): void {
    this.callback([], this);
  }
}

class MockResizeObserver {
  callback: ResizeObserverCallback;
  static instances: MockResizeObserver[] = [];
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  trigger(): void {
    this.callback([], this);
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("useAutoScroll", () => {
  let origMO: typeof MutationObserver;
  let origRO: typeof ResizeObserver;
  let origRAF: typeof requestAnimationFrame;
  let origCAF: typeof cancelAnimationFrame;

  let rafQueue: Map<number, FrameRequestCallback>;
  let nextRafId: number;

  /** Flush all pending requestAnimationFrame callbacks (including nested). */
  function flushRafs() {
    let safety = 20;
    while (rafQueue.size > 0 && --safety > 0) {
      const batch = new Map(rafQueue);
      rafQueue.clear();
      for (const [, fn] of batch) {
        fn(performance.now());
      }
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    origMO = globalThis.MutationObserver;
    origRO = globalThis.ResizeObserver;
    origRAF = globalThis.requestAnimationFrame;
    origCAF = globalThis.cancelAnimationFrame;
    MockMutationObserver.instances = [];
    MockResizeObserver.instances = [];

    globalThis.MutationObserver =
      MockMutationObserver as unknown as typeof MutationObserver;
    globalThis.ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;

    nextRafId = 0;
    rafQueue = new Map();
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      const id = ++nextRafId;
      rafQueue.set(id, cb);
      return id;
    };
    globalThis.cancelAnimationFrame = (id: number) => {
      rafQueue.delete(id);
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.MutationObserver = origMO;
    globalThis.ResizeObserver = origRO;
    globalThis.requestAnimationFrame = origRAF;
    globalThis.cancelAnimationFrame = origCAF;
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Realistic defaults: scrolled to the very bottom. */
  function makeEl(
    overrides: Partial<{
      scrollHeight: number;
      scrollTop: number;
      clientHeight: number;
      clientWidth: number;
    }> = {},
  ): HTMLDivElement {
    const el = document.createElement("div");
    const sh = overrides.scrollHeight ?? 1000;
    const ch = overrides.clientHeight ?? 400;
    Object.defineProperties(el, {
      scrollHeight: { value: sh, writable: true, configurable: true },
      scrollTop: { value: overrides.scrollTop ?? sh - ch, writable: true, configurable: true },
      clientHeight: { value: ch, writable: true, configurable: true },
      clientWidth: { value: overrides.clientWidth ?? 300, writable: true, configurable: true },
    });
    return el;
  }

  function latestMO(): MockMutationObserver {
    return MockMutationObserver.instances[MockMutationObserver.instances.length - 1];
  }

  function latestRO(): MockResizeObserver {
    return MockResizeObserver.instances[MockResizeObserver.instances.length - 1];
  }

  // ---------------------------------------------------------------------------
  // API & lifecycle
  // ---------------------------------------------------------------------------

  it("returns handleScroll and scrollToBottom functions", () => {
    const ref = { current: makeEl() };
    const { result } = renderHook(() => useAutoScroll(ref));
    expect(typeof result.current.handleScroll).toBe("function");
    expect(typeof result.current.scrollToBottom).toBe("function");
  });

  it("sets up MutationObserver and ResizeObserver on mount", () => {
    const ref = { current: makeEl() };
    renderHook(() => useAutoScroll(ref));
    expect(MockMutationObserver.instances).toHaveLength(1);
    expect(MockResizeObserver.instances).toHaveLength(1);
    expect(latestMO().observe).toHaveBeenCalledWith(ref.current, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });

  it("disconnects observers on unmount", () => {
    const ref = { current: makeEl() };
    const { unmount } = renderHook(() => useAutoScroll(ref));
    const mo = latestMO();
    const ro = latestRO();
    unmount();
    expect(mo.disconnect).toHaveBeenCalled();
    expect(ro.disconnect).toHaveBeenCalled();
  });

  it("handles null ref without throwing", () => {
    const ref: React.RefObject<HTMLElement | null> = { current: null };
    const { result } = renderHook(() => useAutoScroll(ref));
    expect(() => {
      act(() => result.current.handleScroll());
      act(() => result.current.scrollToBottom());
    }).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Initial mount scroll
  // ---------------------------------------------------------------------------

  it("scrolls to the bottom on mount", () => {
    const el = makeEl({ scrollTop: 200 });
    const ref = { current: el };
    renderHook(() => useAutoScroll(ref));
    flushRafs();
    expect(el.scrollTop).toBe(1000);
  });

  // ---------------------------------------------------------------------------
  // scrollToBottom
  // ---------------------------------------------------------------------------

  it("scrollToBottom sets scrollTop to scrollHeight", () => {
    const el = makeEl();
    const ref = { current: el };
    const { result } = renderHook(() => useAutoScroll(ref));
    (el as any).scrollHeight = 2000;
    act(() => result.current.scrollToBottom());
    expect(el.scrollTop).toBe(2000);
  });

  it("scrollToBottom re-enables auto-scroll after user scrolled up", () => {
    const el = makeEl();
    const ref = { current: el };
    const { result } = renderHook(() => useAutoScroll(ref));
    flushRafs();

    // User scrolls far up
    (el as any).scrollTop = 100;
    act(() => result.current.handleScroll());

    // Verify auto-scroll is off
    (el as any).scrollHeight = 1200;
    act(() => latestMO().trigger());
    flushRafs();
    expect(el.scrollTop).toBe(100);

    // scrollToBottom should re-enable
    act(() => result.current.scrollToBottom());
    expect(el.scrollTop).toBe(1200);

    // Subsequent mutations should auto-scroll again
    flushRafs();
    (el as any).scrollHeight = 1500;
    act(() => latestMO().trigger());
    flushRafs();
    expect(el.scrollTop).toBe(1500);
  });

  // ---------------------------------------------------------------------------
  // Mutation-triggered auto-scroll
  // ---------------------------------------------------------------------------

  it("scrolls to bottom on mutation when auto-scroll is active", () => {
    const el = makeEl();
    const ref = { current: el };
    renderHook(() => useAutoScroll(ref));
    flushRafs();

    (el as any).scrollHeight = 1400;
    act(() => latestMO().trigger());
    flushRafs();
    expect(el.scrollTop).toBe(1400);
  });

  it("does NOT scroll on mutation when user has scrolled up", () => {
    const el = makeEl();
    const ref = { current: el };
    const { result } = renderHook(() => useAutoScroll(ref));
    flushRafs();

    (el as any).scrollTop = 100;
    act(() => result.current.handleScroll());

    (el as any).scrollHeight = 1400;
    act(() => latestMO().trigger());
    flushRafs();
    expect(el.scrollTop).toBe(100);
  });

  it("re-enables auto-scroll when user scrolls back near the bottom", () => {
    const el = makeEl();
    const ref = { current: el };
    const { result } = renderHook(() => useAutoScroll(ref));
    flushRafs();

    // Scroll up
    (el as any).scrollTop = 100;
    act(() => result.current.handleScroll());

    // Scroll back near bottom (within 40px threshold)
    // scrollHeight(1000) - scrollTop(580) - clientHeight(400) = 20 < 40
    (el as any).scrollTop = 580;
    act(() => result.current.handleScroll());

    (el as any).scrollHeight = 1400;
    act(() => latestMO().trigger());
    flushRafs();
    expect(el.scrollTop).toBe(1400);
  });

  // ---------------------------------------------------------------------------
  // 40px threshold boundary
  // ---------------------------------------------------------------------------

  it("39px from bottom → treated as at bottom", () => {
    const el = makeEl();
    const ref = { current: el };
    const { result } = renderHook(() => useAutoScroll(ref));
    flushRafs();

    // 1000 - 561 - 400 = 39 < 40
    (el as any).scrollTop = 561;
    act(() => result.current.handleScroll());

    (el as any).scrollHeight = 1200;
    act(() => latestMO().trigger());
    flushRafs();
    expect(el.scrollTop).toBe(1200);
  });

  it("41px from bottom → treated as scrolled away", () => {
    const el = makeEl();
    const ref = { current: el };
    const { result } = renderHook(() => useAutoScroll(ref));
    flushRafs();
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    // 1000 - 559 - 400 = 41 >= 40
    (el as any).scrollTop = 559;
    act(() => result.current.handleScroll());

    (el as any).scrollHeight = 1200;
    act(() => latestMO().trigger());
    flushRafs();
    expect(el.scrollTop).toBe(559);
  });

  // ---------------------------------------------------------------------------
  // Initial settling window
  // ---------------------------------------------------------------------------

  it("keeps auto-scroll pinned during settling for small upward deltas", () => {
    const el = makeEl();
    const ref = { current: el };
    const { result } = renderHook(() => useAutoScroll(ref));
    flushRafs();

    // Small upward adjustment during virtualizer settling should be ignored.
    (el as any).scrollTop = 559;
    act(() => result.current.handleScroll());

    (el as any).scrollHeight = 1200;
    act(() => latestMO().trigger());
    flushRafs();
    expect(el.scrollTop).toBe(1200);
  });

  it("exits settling and respects user intent on strong upward scroll", () => {
    const el = makeEl();
    const ref = { current: el };
    const { result } = renderHook(() => useAutoScroll(ref));
    flushRafs();

    // Strong upward move should immediately disable auto-scroll.
    (el as any).scrollTop = 100;
    act(() => result.current.handleScroll());

    (el as any).scrollHeight = 1400;
    act(() => latestMO().trigger());
    flushRafs();
    expect(el.scrollTop).toBe(100);
  });

  it("falls back to normal at-bottom detection after settling timeout", () => {
    const el = makeEl();
    const ref = { current: el };
    const { result } = renderHook(() => useAutoScroll(ref));
    flushRafs();
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    // Outside settling, 41px from bottom disables auto-scroll.
    (el as any).scrollTop = 559;
    act(() => result.current.handleScroll());

    (el as any).scrollHeight = 1200;
    act(() => latestMO().trigger());
    flushRafs();
    expect(el.scrollTop).toBe(559);
  });

  // ---------------------------------------------------------------------------
  // Programmatic scroll guard
  // ---------------------------------------------------------------------------

  it("handleScroll is a no-op while the programmatic scroll guard is active", () => {
    const el = makeEl();
    const ref = { current: el };
    const { result } = renderHook(() => useAutoScroll(ref));
    flushRafs();

    // scrollToBottom activates the guard
    act(() => result.current.scrollToBottom());

    // Simulate the race condition: scrollHeight grows before the scroll event
    // handler fires. Without the guard, this would compute
    // 1500 - 1000 - 400 = 100 > 40 and disable auto-scroll.
    (el as any).scrollHeight = 1500;
    act(() => result.current.handleScroll());

    // Auto-scroll should still be active
    act(() => latestMO().trigger());
    flushRafs();
    expect(el.scrollTop).toBe(1500);
  });

  it("programmatic scroll guard clears after its RAF fires", () => {
    const el = makeEl();
    const ref = { current: el };
    const { result } = renderHook(() => useAutoScroll(ref));
    flushRafs();

    act(() => result.current.scrollToBottom());
    flushRafs(); // clears the guard

    // handleScroll should work normally now — scroll up disables auto-scroll
    (el as any).scrollTop = 100;
    act(() => result.current.handleScroll());

    (el as any).scrollHeight = 1200;
    act(() => latestMO().trigger());
    flushRafs();
    expect(el.scrollTop).toBe(100);
  });

  // ---------------------------------------------------------------------------
  // MutationObserver RAF deduplication
  // ---------------------------------------------------------------------------

  it("coalesces rapid mutations into a single RAF", () => {
    const ref = { current: makeEl() };
    renderHook(() => useAutoScroll(ref));
    flushRafs();
    const before = nextRafId;
    (ref.current as any).scrollHeight = 1100;

    act(() => {
      latestMO().trigger();
      latestMO().trigger();
      latestMO().trigger();
    });

    expect(nextRafId - before).toBe(1);
  });

  it("schedules a new RAF after the previous one fires", () => {
    const ref = { current: makeEl() };
    renderHook(() => useAutoScroll(ref));
    flushRafs();

    (ref.current as any).scrollHeight = 1100;
    act(() => latestMO().trigger());
    expect(rafQueue.size).toBe(1);

    flushRafs();
    expect(rafQueue.size).toBe(0);

    (ref.current as any).scrollHeight = 1200;
    act(() => latestMO().trigger());
    expect(rafQueue.size).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // ResizeObserver
  // ---------------------------------------------------------------------------

  it("scrolls to bottom on width change when auto-scroll is active", () => {
    const el = makeEl({ clientWidth: 300 });
    const ref = { current: el };
    renderHook(() => useAutoScroll(ref));
    flushRafs();

    (el as any).clientWidth = 500;
    (el as any).scrollHeight = 1400;
    act(() => latestRO().trigger());

    expect(el.scrollTop).toBe(1400);
  });

  it("proportionally adjusts scroll position on width change when auto-scroll is off", () => {
    const el = makeEl({ clientWidth: 300 });
    const ref = { current: el };
    const { result } = renderHook(() => useAutoScroll(ref));
    flushRafs();

    // Scroll up (auto-scroll off)
    (el as any).scrollTop = 300;
    act(() => result.current.handleScroll());

    // Width changes causing content reflow
    (el as any).clientWidth = 500;
    (el as any).scrollHeight = 2000;
    act(() => latestRO().trigger());

    // 300 * (2000 / 1000) = 600
    expect(el.scrollTop).toBe(600);
  });

  it("ignores resize when width has not changed", () => {
    const el = makeEl({ clientWidth: 300 });
    const ref = { current: el };
    renderHook(() => useAutoScroll(ref));
    flushRafs();

    const scrollTopBefore = el.scrollTop;
    (el as any).scrollHeight = 1500;
    // clientWidth stays 300 — resize observer fires but should bail out
    act(() => latestRO().trigger());

    expect(el.scrollTop).toBe(scrollTopBefore);
  });

  // ---------------------------------------------------------------------------
  // resetKey
  // ---------------------------------------------------------------------------

  it("re-enables auto-scroll and recreates observers when resetKey changes", () => {
    const el = makeEl();
    const ref = { current: el };
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useAutoScroll(ref, key),
      { initialProps: { key: "a" } },
    );
    flushRafs();

    // User scrolls up → auto-scroll disabled
    (el as any).scrollTop = 100;
    act(() => result.current.handleScroll());

    const oldMO = latestMO();
    const oldRO = latestRO();

    // Switch conversation
    rerender({ key: "b" });
    flushRafs();

    // Old observers disconnected, new ones created
    expect(oldMO.disconnect).toHaveBeenCalled();
    expect(oldRO.disconnect).toHaveBeenCalled();
    expect(MockMutationObserver.instances).toHaveLength(2);
    expect(MockResizeObserver.instances).toHaveLength(2);

    // auto-scroll was re-enabled → should be at the bottom
    expect(el.scrollTop).toBe(1000);

    // Subsequent mutations should auto-scroll
    (el as any).scrollHeight = 1300;
    act(() => latestMO().trigger());
    flushRafs();
    expect(el.scrollTop).toBe(1300);
  });

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  it("cancels pending mutation RAF on unmount", () => {
    const el = makeEl();
    const ref = { current: el };
    const { unmount } = renderHook(() => useAutoScroll(ref));
    flushRafs();

    // Schedule a mutation RAF, then unmount before it fires
    (el as any).scrollHeight = 1300;
    act(() => latestMO().trigger());
    expect(rafQueue.size).toBeGreaterThan(0);

    unmount();

    // The cleanup should have cancelled the pending RAF
    expect(rafQueue.size).toBe(0);
  });
});
