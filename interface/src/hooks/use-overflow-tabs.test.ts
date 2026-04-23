import { act, renderHook } from "@testing-library/react";
import { useOverflowTabs } from "./use-overflow-tabs";

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

// Shared accessor so a test can replace the default mock with a version
// that captures the ResizeObserver callback, letting us simulate a
// container width change after mount.
function installCapturingResizeObserver(): {
  trigger: () => void;
  restore: () => void;
} {
  let captured: (() => void) | null = null;
  class CapturingRO {
    constructor(cb: () => void) {
      captured = cb;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const previous = globalThis.ResizeObserver;
  globalThis.ResizeObserver = CapturingRO as unknown as typeof ResizeObserver;

  const previousRaf = globalThis.requestAnimationFrame;
  const previousCaf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id)) as typeof cancelAnimationFrame;

  return {
    trigger: () => captured?.(),
    restore: () => {
      globalThis.ResizeObserver = previous;
      globalThis.requestAnimationFrame = previousRaf;
      globalThis.cancelAnimationFrame = previousCaf;
    },
  };
}

function makeContainerRef(overrides?: {
  containerWidth?: number;
  buttonWidth?: number;
  tabGap?: number;
  containerGap?: number;
  paddingLeft?: number;
  paddingRight?: number;
}) {
  const {
    containerWidth = 400,
    buttonWidth = 40,
    tabGap = 4,
    containerGap = 8,
    paddingLeft = 0,
    paddingRight = 0,
  } = overrides ?? {};

  const button = {
    offsetWidth: buttonWidth,
  } as HTMLElement;

  const tabBar = {
    querySelector: () => button,
  } as unknown as HTMLElement;

  const container = {
    firstElementChild: tabBar,
    clientWidth: containerWidth,
  } as unknown as HTMLElement;

  vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) => {
    if (el === tabBar) {
      return { gap: `${tabGap}px` } as CSSStyleDeclaration;
    }
    return {
      gap: `${containerGap}px`,
      paddingLeft: `${paddingLeft}px`,
      paddingRight: `${paddingRight}px`,
    } as CSSStyleDeclaration;
  });

  return { current: container } as React.RefObject<HTMLElement>;
}

describe("useOverflowTabs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns all items when they fit", () => {
    const items = ["a", "b", "c"];
    const ref = makeContainerRef({ containerWidth: 500, buttonWidth: 40, tabGap: 4 });

    const { result } = renderHook(() => useOverflowTabs(ref, items));

    expect(result.current.visibleItems).toEqual(["a", "b", "c"]);
    expect(result.current.overflowItems).toEqual([]);
  });

  it("splits items when container is too narrow", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const ref = makeContainerRef({ containerWidth: 200, buttonWidth: 40, tabGap: 4 });

    const { result } = renderHook(() => useOverflowTabs(ref, items));

    expect(result.current.visibleItems.length).toBeLessThan(items.length);
    expect(result.current.overflowItems.length).toBeGreaterThan(0);
    expect([
      ...result.current.visibleItems,
      ...result.current.overflowItems,
    ]).toEqual(items);
  });

  it("returns all items when items is empty", () => {
    const ref = makeContainerRef();
    const { result } = renderHook(() => useOverflowTabs(ref, []));

    expect(result.current.visibleItems).toEqual([]);
    expect(result.current.overflowItems).toEqual([]);
  });

  it("handles null container ref", () => {
    const ref = { current: null } as React.RefObject<HTMLElement | null>;
    const items = ["a", "b"];

    const { result } = renderHook(() => useOverflowTabs(ref, items));

    expect(result.current.visibleItems).toEqual(["a", "b"]);
    expect(result.current.overflowItems).toEqual([]);
  });

  it("always reserves more-button slot when alwaysShowMore is true", () => {
    const items = ["a", "b", "c"];
    const ref = makeContainerRef({ containerWidth: 200, buttonWidth: 40, tabGap: 4, containerGap: 8 });

    const { result } = renderHook(() => useOverflowTabs(ref, items, true));

    expect(result.current.visibleItems.length).toBeLessThanOrEqual(items.length);
    expect([
      ...result.current.visibleItems,
      ...result.current.overflowItems,
    ]).toEqual(items);
  });

  it("ensures at least 1 visible item even when space is very small", () => {
    const items = ["a", "b", "c", "d", "e"];
    const ref = makeContainerRef({ containerWidth: 50, buttonWidth: 40, tabGap: 4 });

    const { result } = renderHook(() => useOverflowTabs(ref, items));

    expect(result.current.visibleItems.length).toBeGreaterThanOrEqual(1);
  });

  it("does not flip an overflowed tab back into view from sub-pixel jitter", async () => {
    // Regression test for the Debug sidekick "logs icon doubled + blinking"
    // bug: at the width where the last tab just barely fits, integer-floor
    // measurement noise used to flip maxVisible between N-1 and N on every
    // ResizeObserver tick, rendering the 8th icon next to the More button
    // for 150 ms of exit animation each time.
    const items = ["a", "b", "c", "d", "e", "f", "g", "h"];
    // Math:
    //   btnW=40, tabGap=4, containerGap=8 → slot=44, moreSlot=48.
    //   Width to fit N tabs + more = N*40 + (N-1)*4 + 48
    //   N=7 → 356, N=8 → 396. Start at N=7 comfortably.
    const ref = makeContainerRef({
      containerWidth: 360,
      buttonWidth: 40,
      tabGap: 4,
      containerGap: 8,
    });

    const capture = installCapturingResizeObserver();

    try {
      const { result } = renderHook(() => useOverflowTabs(ref, items, true));
      expect(result.current.visibleItems).toHaveLength(7);

      // Grow the container by just barely enough that the raw floor
      // computation would pick N=8 but with only 3 px of slack past
      // the threshold – below the hysteresis budget. The 8th tab
      // should stay in overflow rather than oscillate back.
      (ref.current as unknown as { clientWidth: number }).clientWidth = 399;
      await act(async () => {
        capture.trigger();
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
      expect(result.current.visibleItems).toHaveLength(7);

      // Once there's enough slack past the threshold, the 8th tab is
      // allowed back in.
      (ref.current as unknown as { clientWidth: number }).clientWidth = 420;
      await act(async () => {
        capture.trigger();
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
      expect(result.current.visibleItems).toHaveLength(8);
    } finally {
      capture.restore();
    }
  });
});
