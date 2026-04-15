import { renderHook, act } from "@testing-library/react";
import { useScrollAnchor } from "./use-scroll-anchor";

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

interface HookOptions {
  resetKey?: unknown;
  contentReady?: boolean;
  layoutState?: {
    signature: string;
    coversTail: boolean;
  } | null;
}

const DEFAULT_OPTIONS: Required<HookOptions> = {
  resetKey: "default",
  contentReady: true,
  layoutState: null,
};

const NULL_SENTINEL: React.RefObject<HTMLElement | null> = { current: null };

describe("useScrollAnchor", () => {
  let origMO: typeof MutationObserver;
  let origRO: typeof ResizeObserver;
  let origRAF: typeof requestAnimationFrame;
  let origCAF: typeof cancelAnimationFrame;

  let rafQueue: Map<number, FrameRequestCallback>;
  let nextRafId: number;

  /** Flush all pending requestAnimationFrame callbacks (including nested). */
  function flushRafs() {
    let safety = 30;
    while (rafQueue.size > 0 && --safety > 0) {
      const batch = new Map(rafQueue);
      rafQueue.clear();
      for (const [, fn] of batch) {
        fn(performance.now());
      }
    }
  }

  /** Flush exactly one pending RAF callback. */
  function flushOneRaf() {
    const iter = rafQueue.entries().next();
    if (iter.done) return;
    const [id, fn] = iter.value;
    rafQueue.delete(id);
    fn(performance.now());
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

  /** The container-width ResizeObserver (first created per setup round). */
  function containerRO(round = 0): MockResizeObserver {
    return MockResizeObserver.instances[round * 2];
  }

  /** The content-height ResizeObserver (second created per setup round). */
  function contentRO(round = 0): MockResizeObserver {
    return MockResizeObserver.instances[round * 2 + 1];
  }

  /**
   * Render the hook with content ready and flush settling so tests
   * start in the active phase.
   */
  function renderSettled(
    elOverrides: Parameters<typeof makeEl>[0] = {},
    optOverrides: HookOptions = {},
  ) {
    const el = makeEl(elOverrides);
    const ref = { current: el };
    const opts = { ...DEFAULT_OPTIONS, ...optOverrides };
    const hook = renderHook(
      (p: typeof opts) => useScrollAnchor(ref, NULL_SENTINEL, p),
      { initialProps: opts },
    );
    // First flush: settling RAFs + reveal guard.
    // The React commit that follows fires the post-reveal
    // useLayoutEffect, which sets a new guard.
    act(() => flushRafs());
    // Second flush: clear the layout effect's guard RAF.
    act(() => flushRafs());
    return { el, ref, ...hook };
  }

  function triggerMutation(observer: MockMutationObserver = latestMO()) {
    act(() => {
      observer.trigger();
      flushRafs();
    });
  }

  function triggerContainerResize(round = 0) {
    act(() => {
      containerRO(round).trigger();
      flushRafs();
    });
  }

  function triggerContentResize(round = 0) {
    act(() => {
      contentRO(round).trigger();
      flushRafs();
    });
  }

  // ---------------------------------------------------------------------------
  // API & lifecycle
  // ---------------------------------------------------------------------------

  it("returns handleScroll, scrollToBottom, scrollToBottomIfPinned, isReady, and isAutoFollowing", () => {
    const ref = { current: makeEl() };
    const { result } = renderHook(() =>
      useScrollAnchor(ref, NULL_SENTINEL, DEFAULT_OPTIONS),
    );
    expect(typeof result.current.handleScroll).toBe("function");
    expect(typeof result.current.scrollToBottom).toBe("function");
    expect(typeof result.current.scrollToBottomIfPinned).toBe("function");
    expect(typeof result.current.isReady).toBe("boolean");
    expect(typeof result.current.isAutoFollowing).toBe("boolean");
  });

  it("sets up MutationObserver and ResizeObservers on mount", () => {
    const ref = { current: makeEl() };
    renderHook(() => useScrollAnchor(ref, NULL_SENTINEL, DEFAULT_OPTIONS));
    expect(MockMutationObserver.instances).toHaveLength(1);
    expect(MockResizeObserver.instances).toHaveLength(2);
    expect(latestMO().observe).toHaveBeenCalledWith(ref.current, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });

  it("disconnects observers on unmount", () => {
    const { unmount } = renderSettled();
    const mo = latestMO();
    const cRO = containerRO();
    const ctRO = contentRO();
    unmount();
    expect(mo.disconnect).toHaveBeenCalled();
    expect(cRO.disconnect).toHaveBeenCalled();
    expect(ctRO.disconnect).toHaveBeenCalled();
  });

  it("handles null ref without throwing", () => {
    const ref: React.RefObject<HTMLElement | null> = { current: null };
    const { result } = renderHook(() =>
      useScrollAnchor(ref, NULL_SENTINEL, DEFAULT_OPTIONS),
    );
    expect(() => {
      act(() => result.current.handleScroll());
      act(() => result.current.scrollToBottom());
    }).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Settling phase
  // ---------------------------------------------------------------------------

  it("isReady starts false", () => {
    const ref = { current: makeEl() };
    const { result } = renderHook(() =>
      useScrollAnchor(ref, NULL_SENTINEL, DEFAULT_OPTIONS),
    );
    // Don't flush RAFs — still settling
    expect(result.current.isReady).toBe(false);
  });

  it("isReady becomes true after settling completes", () => {
    const { result } = renderSettled();
    expect(result.current.isReady).toBe(true);
  });

  it("scrolls to bottom after settling", () => {
    const { el } = renderSettled({ scrollTop: 200 });
    expect(el.scrollTop).toBe(1000);
  });

  it("reveals via stability polling even with no content", () => {
    const el = makeEl();
    const ref = { current: el };
    const { result } = renderHook(() =>
      useScrollAnchor(ref, NULL_SENTINEL, DEFAULT_OPTIONS),
    );
    act(() => flushRafs());
    expect(result.current.isReady).toBe(true);
  });

  it("waits for contentReady before settling", () => {
    const el = makeEl();
    const ref = { current: el };
    const opts = { ...DEFAULT_OPTIONS, contentReady: false };
    const { result, rerender } = renderHook(
      (p: typeof opts) => useScrollAnchor(ref, NULL_SENTINEL, p),
      { initialProps: opts },
    );
    act(() => flushRafs());
    expect(result.current.isReady).toBe(false);

    rerender({ ...opts, contentReady: true });
    act(() => flushRafs());
    expect(result.current.isReady).toBe(true);
  });

  it("waits for the virtualized layout to reach the tail before revealing", () => {
    const el = makeEl();
    const ref = { current: el };
    const opts = {
      ...DEFAULT_OPTIONS,
      layoutState: { signature: "top-window", coversTail: false },
    };
    const { result, rerender } = renderHook(
      (p: typeof opts) => useScrollAnchor(ref, NULL_SENTINEL, p),
      { initialProps: opts },
    );

    act(() => flushRafs());
    expect(result.current.isReady).toBe(false);

    rerender({
      ...opts,
      layoutState: { signature: "bottom-window:measuring", coversTail: true },
    });
    act(() => flushOneRaf());
    expect(result.current.isReady).toBe(false);

    rerender({
      ...opts,
      layoutState: { signature: "bottom-window:settled", coversTail: true },
    });
    act(() => flushRafs());
    expect(result.current.isReady).toBe(true);
  });

  it("does not reveal while the bottom window keeps changing", () => {
    const el = makeEl();
    const ref = { current: el };
    const opts = {
      ...DEFAULT_OPTIONS,
      layoutState: { signature: "tail-pass-1", coversTail: true },
    };
    const { result, rerender } = renderHook(
      (p: typeof opts) => useScrollAnchor(ref, NULL_SENTINEL, p),
      { initialProps: opts },
    );

    act(() => flushOneRaf());
    expect(result.current.isReady).toBe(false);

    rerender({
      ...opts,
      layoutState: { signature: "tail-pass-2", coversTail: true },
    });
    act(() => flushOneRaf());
    expect(result.current.isReady).toBe(false);

    rerender({
      ...opts,
      layoutState: { signature: "tail-pass-3", coversTail: true },
    });
    act(() => flushOneRaf());
    expect(result.current.isReady).toBe(false);

    act(() => flushRafs());
    expect(result.current.isReady).toBe(true);
  });

  it("does not reveal from the timeout while a layout signal is still present", () => {
    const el = makeEl();
    const ref = { current: el };
    const opts = {
      ...DEFAULT_OPTIONS,
      layoutState: { signature: "tail-pass-1", coversTail: true },
    };
    const { result } = renderHook(() => useScrollAnchor(ref, NULL_SENTINEL, opts));

    act(() => {
      vi.advanceTimersByTime(2200);
    });
    expect(result.current.isReady).toBe(false);

    act(() => flushRafs());
    expect(result.current.isReady).toBe(true);
  });

  it("waits until the sentinel is inside the viewport before revealing", () => {
    const el = makeEl();
    const ref = { current: el };
    const sentinel = document.createElement("div");
    let sentinelTop = 900;
    vi.spyOn(sentinel, "getBoundingClientRect").mockImplementation(() => ({
      x: 0,
      y: sentinelTop,
      width: 0,
      height: 0,
      top: sentinelTop,
      right: 0,
      bottom: sentinelTop,
      left: 0,
      toJSON: () => ({}),
    }));
    vi.spyOn(el, "getBoundingClientRect").mockImplementation(() => ({
      x: 0,
      y: 0,
      width: 300,
      height: 400,
      top: 0,
      right: 300,
      bottom: 400,
      left: 0,
      toJSON: () => ({}),
    }));
    const sentinelRef = { current: sentinel };
    const opts = {
      ...DEFAULT_OPTIONS,
      layoutState: { signature: "tail-settled", coversTail: true },
    };
    const { result } = renderHook(() => useScrollAnchor(ref, sentinelRef, opts));

    act(() => flushRafs());
    expect(result.current.isReady).toBe(false);

    sentinelTop = 200;
    act(() => flushRafs());
    expect(result.current.isReady).toBe(true);
  });

  it("keeps pinned to bottom during settling for small upward deltas", () => {
    const { el, result } = renderSettled();

    // Small upward adjustment during settling on a fresh resetKey should
    // not break pinning after settling.
    (el as any).scrollHeight = 1200;
    triggerMutation();
    expect(el.scrollTop).toBe(1200);
  });

  it("exits settling and respects user intent on strong upward scroll", () => {
    const el = makeEl();
    const ref = { current: el };
    const opts = { ...DEFAULT_OPTIONS, contentReady: false };
    const { result, rerender } = renderHook(
      (p: typeof opts) => useScrollAnchor(ref, NULL_SENTINEL, p),
      { initialProps: opts },
    );

    // Make contentReady but don't finish settling — flush only 1 RAF
    rerender({ ...opts, contentReady: true });
    act(() => flushOneRaf());

    // Strong upward scroll should escape settling
    (el as any).scrollTop = 100;
    act(() => result.current.handleScroll());

    // Should have revealed and be unpinned
    expect(result.current.isReady).toBe(true);

    // Subsequent mutations should NOT auto-scroll
    (el as any).scrollHeight = 1400;
    triggerMutation();
    expect(el.scrollTop).toBe(100);
  });

  it("safety timeout defers reveal until contentReady is true", () => {
    const el = makeEl();
    const ref = { current: el };
    const opts = { ...DEFAULT_OPTIONS, contentReady: false };
    const { result, rerender } = renderHook(
      (p: typeof opts) => useScrollAnchor(ref, NULL_SENTINEL, p),
      { initialProps: opts },
    );
    expect(result.current.isReady).toBe(false);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.isReady).toBe(false);

    rerender({ ...opts, contentReady: true });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.isReady).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // scrollToBottom
  // ---------------------------------------------------------------------------

  it("scrollToBottom sets scrollTop to scrollHeight", () => {
    const { el, result } = renderSettled();
    (el as any).scrollHeight = 2000;
    act(() => result.current.scrollToBottom());
    expect(el.scrollTop).toBe(2000);
  });

  it("scrollToBottom re-enables auto-scroll after user scrolled up", () => {
    const { el, result } = renderSettled();

    // User scrolls far up
    (el as any).scrollTop = 100;
    act(() => result.current.handleScroll());

    // Verify auto-scroll is off
    (el as any).scrollHeight = 1200;
    triggerMutation();
    expect(el.scrollTop).toBe(100);

    // scrollToBottom should re-enable
    act(() => result.current.scrollToBottom());
    expect(el.scrollTop).toBe(1200);

    // Subsequent mutations should auto-scroll again
    (el as any).scrollHeight = 1500;
    triggerMutation();
    expect(el.scrollTop).toBe(1500);
  });

  // ---------------------------------------------------------------------------
  // Mutation-triggered auto-scroll
  // ---------------------------------------------------------------------------

  it("scrolls to bottom on mutation when pinned", () => {
    const { el } = renderSettled();
    (el as any).scrollHeight = 1400;
    triggerMutation();
    expect(el.scrollTop).toBe(1400);
  });

  it("batches mutation-driven remeasure work through RAF before scrolling", () => {
    const { el } = renderSettled();
    const rafsBefore = nextRafId;

    (el as any).scrollHeight = 1400;
    act(() => latestMO().trigger());

    expect(el.scrollTop).toBe(1000);
    expect(nextRafId - rafsBefore).toBe(1); // mutation-settle RAF

    act(() => flushOneRaf());
    expect(el.scrollTop).toBe(1000);
    expect(nextRafId - rafsBefore).toBe(2); // mutation-settle RAF + content-change RAF

    act(() => flushOneRaf());
    expect(el.scrollTop).toBe(1400);
    expect(nextRafId - rafsBefore).toBe(3); // ... + guard RAF
  });

  it("does NOT scroll on mutation when user has scrolled up", () => {
    const { el, result } = renderSettled();

    (el as any).scrollTop = 100;
    act(() => result.current.handleScroll());

    (el as any).scrollHeight = 1400;
    triggerMutation();
    expect(el.scrollTop).toBe(100);
  });

  it("re-enables auto-scroll when user scrolls back near the bottom", () => {
    const { el, result } = renderSettled();

    // Scroll up
    (el as any).scrollTop = 100;
    act(() => result.current.handleScroll());

    // Scroll back near bottom (within 40px threshold)
    // scrollHeight(1000) - scrollTop(580) - clientHeight(400) = 20 < 40
    (el as any).scrollTop = 580;
    act(() => result.current.handleScroll());

    (el as any).scrollHeight = 1400;
    triggerMutation();
    expect(el.scrollTop).toBe(1400);
  });

  it("tracks whether auto-follow is active", () => {
    const { el, result } = renderSettled();

    expect(result.current.isAutoFollowing).toBe(true);

    (el as any).scrollTop = 100;
    act(() => result.current.handleScroll());
    expect(result.current.isAutoFollowing).toBe(false);

    act(() => result.current.scrollToBottom());
    expect(result.current.isAutoFollowing).toBe(true);
  });

  it("unpins auto-follow for user-driven collapse reflow", () => {
    const el = makeEl();
    const button = document.createElement("button");
    el.appendChild(button);
    document.body.appendChild(el);
    const ref = { current: el };
    const { result, unmount } = renderHook(
      (p: Required<HookOptions>) => useScrollAnchor(ref, NULL_SENTINEL, p),
      { initialProps: DEFAULT_OPTIONS },
    );
    act(() => flushRafs());
    act(() => flushRafs());

    button.focus();
    expect(document.activeElement).toBe(button);

    (el as any).scrollHeight = 800;
    triggerContentResize();

    expect(el.scrollTop).toBe(1000);
    expect(result.current.isAutoFollowing).toBe(false);

    unmount();
    el.remove();
  });

  // ---------------------------------------------------------------------------
  // 40px threshold boundary
  // ---------------------------------------------------------------------------

  it("39px from bottom → treated as at bottom", () => {
    const { el, result } = renderSettled();

    // 1000 - 561 - 400 = 39 < 40
    (el as any).scrollTop = 561;
    act(() => result.current.handleScroll());

    (el as any).scrollHeight = 1200;
    triggerMutation();
    expect(el.scrollTop).toBe(1200);
  });

  it("41px from bottom → treated as scrolled away", () => {
    const { el, result } = renderSettled();

    // 1000 - 559 - 400 = 41 >= 40
    (el as any).scrollTop = 559;
    act(() => result.current.handleScroll());

    (el as any).scrollHeight = 1200;
    triggerMutation();
    expect(el.scrollTop).toBe(559);
  });

  // ---------------------------------------------------------------------------
  // Programmatic scroll guard
  // ---------------------------------------------------------------------------

  it("handleScroll is a no-op while the programmatic scroll guard is active", () => {
    const { el, result } = renderSettled();

    // scrollToBottom activates the guard
    act(() => result.current.scrollToBottom());

    // Race: scrollHeight grows before the scroll event handler fires.
    // Without the guard, this would compute
    // 1500 - 1000 - 400 = 100 > 40 and disable auto-scroll.
    (el as any).scrollHeight = 1500;
    act(() => result.current.handleScroll());

    // Auto-scroll should still be active
    triggerMutation();
    expect(el.scrollTop).toBe(1500);
  });

  it("programmatic scroll guard clears after its RAF fires", () => {
    const { el, result } = renderSettled();

    act(() => result.current.scrollToBottom());
    act(() => flushRafs()); // clears the guard

    // handleScroll should work normally — scroll up disables auto-scroll
    (el as any).scrollTop = 100;
    act(() => result.current.handleScroll());

    (el as any).scrollHeight = 1200;
    triggerMutation();
    expect(el.scrollTop).toBe(100);
  });

  // ---------------------------------------------------------------------------
  // Synchronous scroll (no RAF batching)
  // ---------------------------------------------------------------------------

  it("each mutation scrolls immediately without waiting for RAF", () => {
    const { el } = renderSettled();

    (el as any).scrollHeight = 1100;
    triggerMutation();
    expect(el.scrollTop).toBe(1100);

    (el as any).scrollHeight = 1200;
    triggerMutation();
    expect(el.scrollTop).toBe(1200);
  });

  // ---------------------------------------------------------------------------
  // Container ResizeObserver (width changes)
  // ---------------------------------------------------------------------------

  it("scrolls to bottom on width change when pinned", () => {
    const { el } = renderSettled({ clientWidth: 300 });

    (el as any).clientWidth = 500;
    (el as any).scrollHeight = 1400;
    triggerContainerResize();
    expect(el.scrollTop).toBe(1400);
  });

  it("preserves scroll position on width change when unpinned", () => {
    const { el, result } = renderSettled({ clientWidth: 300 });

    // Scroll up (auto-scroll off)
    (el as any).scrollTop = 300;
    act(() => result.current.handleScroll());

    // Width changes causing content reflow
    (el as any).clientWidth = 500;
    (el as any).scrollHeight = 2000;
    triggerContainerResize();

    expect(el.scrollTop).toBe(300);
  });

  it("ignores resize when width has not changed", () => {
    const { el } = renderSettled({ clientWidth: 300 });

    const scrollTopBefore = el.scrollTop;
    (el as any).scrollHeight = 1500;
    triggerContainerResize();
    expect(el.scrollTop).toBe(scrollTopBefore);
  });

  it("does not force a bottom correction when width changes but content height is stable", () => {
    const { el } = renderSettled({ clientWidth: 300 });
    const scrollTopBefore = el.scrollTop;

    (el as any).clientWidth = 500;
    triggerContainerResize();

    expect(el.scrollTop).toBe(scrollTopBefore);
  });

  it("re-pins to the bottom when the container height changes and auto-follow is active", () => {
    const { el } = renderSettled({ clientHeight: 400 });

    (el as any).scrollTop = 600;
    (el as any).clientHeight = 300;
    triggerContainerResize();

    expect(el.scrollTop).toBe(1000);
  });

  it("preserves scroll position on container height changes when auto-follow is disabled", () => {
    const { el, result } = renderSettled({ clientHeight: 400 });

    (el as any).scrollTop = 100;
    act(() => result.current.handleScroll());

    (el as any).clientHeight = 300;
    triggerContainerResize();

    expect(el.scrollTop).toBe(100);
  });

  // ---------------------------------------------------------------------------
  // Content ResizeObserver (virtualiser measurement corrections)
  // ---------------------------------------------------------------------------

  it("scrolls to bottom when content child resizes and scrollHeight increases", () => {
    const el = makeEl();
    const child = document.createElement("div");
    el.appendChild(child);
    const ref = { current: el };
    const hook = renderHook(
      (p: Required<HookOptions>) => useScrollAnchor(ref, NULL_SENTINEL, p),
      { initialProps: DEFAULT_OPTIONS },
    );
    act(() => flushRafs());

    (el as any).scrollHeight = 1800;
    triggerContentResize();
    expect(el.scrollTop).toBe(1800);
  });

  it("does NOT scroll on content resize when user has scrolled up", () => {
    const el = makeEl();
    const child = document.createElement("div");
    el.appendChild(child);
    const ref = { current: el };
    const { result } = renderHook(
      (p: Required<HookOptions>) => useScrollAnchor(ref, NULL_SENTINEL, p),
      { initialProps: DEFAULT_OPTIONS },
    );
    act(() => flushRafs());
    act(() => flushRafs()); // clear post-reveal layout effect guard

    (el as any).scrollTop = 100;
    act(() => result.current.handleScroll());

    (el as any).scrollHeight = 1800;
    triggerContentResize();
    expect(el.scrollTop).toBe(100);
  });

  it("observes content children with the content ResizeObserver", () => {
    const el = makeEl();
    const child1 = document.createElement("div");
    const child2 = document.createElement("div");
    el.appendChild(child1);
    el.appendChild(child2);
    const ref = { current: el };
    renderHook(() => useScrollAnchor(ref, NULL_SENTINEL, DEFAULT_OPTIONS));

    const cro = contentRO();
    expect(cro.observe).toHaveBeenCalledTimes(2);
    expect(cro.observe).toHaveBeenCalledWith(child1);
    expect(cro.observe).toHaveBeenCalledWith(child2);
  });

  // ---------------------------------------------------------------------------
  // Height decrease while pinned (streaming → finalised transition)
  // ---------------------------------------------------------------------------

  it("scrolls to bottom on mutation when pinned and scrollHeight DECREASES", () => {
    const { el } = renderSettled();
    // Simulate height drop (e.g. StreamingBubble unmounts)
    (el as any).scrollHeight = 800;
    triggerMutation();
    expect(el.scrollTop).toBe(800);
  });

  it("does NOT scroll on height decrease when user has scrolled up", () => {
    const { el, result } = renderSettled();

    (el as any).scrollTop = 100;
    act(() => result.current.handleScroll());

    (el as any).scrollHeight = 800;
    triggerMutation();
    expect(el.scrollTop).toBe(100);
  });

  it("handles rapid height decrease then increase while pinned", () => {
    const { el } = renderSettled();

    // Height drops (StreamingBubble unmounts)
    (el as any).scrollHeight = 700;
    triggerMutation();
    expect(el.scrollTop).toBe(700);

    // Height jumps back up (virtualiser measures actual row)
    (el as any).scrollHeight = 1400;
    triggerMutation();
    expect(el.scrollTop).toBe(1400);
  });

  // ---------------------------------------------------------------------------
  // scrollToBottomIfPinned
  // ---------------------------------------------------------------------------

  it("scrollToBottomIfPinned scrolls when pinned", () => {
    const { el, result } = renderSettled();
    (el as any).scrollHeight = 2000;
    act(() => result.current.scrollToBottomIfPinned());
    expect(el.scrollTop).toBe(2000);
  });

  it("scrollToBottomIfPinned does nothing when user has scrolled up", () => {
    const { el, result } = renderSettled();

    (el as any).scrollTop = 100;
    act(() => result.current.handleScroll());

    (el as any).scrollHeight = 2000;
    act(() => result.current.scrollToBottomIfPinned());
    expect(el.scrollTop).toBe(100);
  });

  it("scrollToBottomIfPinned does not re-pin after user scrolls up", () => {
    const { el, result } = renderSettled();

    (el as any).scrollTop = 100;
    act(() => result.current.handleScroll());

    act(() => result.current.scrollToBottomIfPinned());

    // Subsequent mutations should NOT auto-scroll
    (el as any).scrollHeight = 1500;
    triggerMutation();
    expect(el.scrollTop).toBe(100);
  });

  // ---------------------------------------------------------------------------
  // resetKey
  // ---------------------------------------------------------------------------

  it("re-enters settling and recreates observers when resetKey changes", () => {
    const el = makeEl();
    const ref = { current: el };
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) =>
        useScrollAnchor(ref, NULL_SENTINEL, { ...DEFAULT_OPTIONS, resetKey: key }),
      { initialProps: { key: "a" } },
    );
    act(() => flushRafs());
    expect(result.current.isReady).toBe(true);

    // User scrolls up → auto-scroll disabled
    (el as any).scrollTop = 100;
    act(() => result.current.handleScroll());

    const oldMO = latestMO();
    const oldContainerRO = containerRO(0);
    const oldContentRO = contentRO(0);

    // Switch conversation
    rerender({ key: "b" });
    act(() => flushRafs());

    // Old observers disconnected, new ones created
    expect(oldMO.disconnect).toHaveBeenCalled();
    expect(oldContainerRO.disconnect).toHaveBeenCalled();
    expect(oldContentRO.disconnect).toHaveBeenCalled();
    expect(MockMutationObserver.instances).toHaveLength(2);
    expect(MockResizeObserver.instances).toHaveLength(4);

    // isReady should be true again after settling
    expect(result.current.isReady).toBe(true);

    // Should be scrolled to bottom
    expect(el.scrollTop).toBe(1000);

    // Subsequent mutations should auto-scroll
    (el as any).scrollHeight = 1300;
    triggerMutation();
    expect(el.scrollTop).toBe(1300);
  });

  it("scrolls to bottom after resetKey change even after a scroll from old observers", () => {
    const el = makeEl();
    const ref = { current: el };
    const { rerender } = renderHook(
      ({ key }: { key: string }) =>
        useScrollAnchor(ref, NULL_SENTINEL, { ...DEFAULT_OPTIONS, resetKey: key }),
      { initialProps: { key: "a" } },
    );
    act(() => flushRafs());

    // Trigger old MutationObserver — scrolls synchronously
    (el as any).scrollHeight = 1500;
    triggerMutation(MockMutationObserver.instances[0]);
    expect(el.scrollTop).toBe(1500);

    // Switch conversations — settling re-scrolls to new content
    (el as any).scrollTop = 0;
    (el as any).scrollHeight = 2000;
    rerender({ key: "b" });
    act(() => flushRafs());

    expect(el.scrollTop).toBe(2000);
  });

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  it("cancels settling RAF and timeout on unmount", () => {
    const el = makeEl();
    const ref = { current: el };
    const { unmount } = renderHook(() =>
      useScrollAnchor(ref, NULL_SENTINEL, { ...DEFAULT_OPTIONS, contentReady: false }),
    );

    // Settling RAF is queued, timeout is scheduled
    expect(rafQueue.size).toBeGreaterThan(0);

    unmount();
    expect(rafQueue.size).toBe(0);
  });
});
