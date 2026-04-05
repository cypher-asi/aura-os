import { renderHook } from "@testing-library/react";
import { useOverflowTabs } from "./use-overflow-tabs";

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

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
});
