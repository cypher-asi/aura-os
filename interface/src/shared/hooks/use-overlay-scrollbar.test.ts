import { act, renderHook } from "@testing-library/react";
import { useOverlayScrollbar } from "./use-overlay-scrollbar";

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const originalResizeObserver = global.ResizeObserver;

function createScrollContainer({
  clientHeight,
  scrollHeight,
  scrollTop = 0,
}: {
  clientHeight: number;
  scrollHeight: number;
  scrollTop?: number;
}) {
  const element = document.createElement("div");
  let currentScrollTop = scrollTop;

  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => currentScrollTop,
    set: (value: number) => {
      currentScrollTop = value;
    },
  });

  return element;
}

describe("useOverlayScrollbar", () => {
  beforeAll(() => {
    global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  });

  afterAll(() => {
    global.ResizeObserver = originalResizeObserver;
  });

  it("shows only while hovered when the container overflows", () => {
    const container = createScrollContainer({ clientHeight: 100, scrollHeight: 300 });
    const containerRef = { current: container };
    const { result } = renderHook(() => useOverlayScrollbar(containerRef));

    expect(result.current.visible).toBe(false);

    act(() => {
      container.dispatchEvent(new MouseEvent("mouseenter"));
    });

    expect(result.current.visible).toBe(true);

    act(() => {
      container.dispatchEvent(new MouseEvent("mouseleave"));
    });

    expect(result.current.visible).toBe(false);
  });

  it("stays hidden when the container does not overflow", () => {
    const container = createScrollContainer({ clientHeight: 100, scrollHeight: 100 });
    const containerRef = { current: container };
    const { result } = renderHook(() => useOverlayScrollbar(containerRef));

    act(() => {
      container.dispatchEvent(new MouseEvent("mouseenter"));
      container.dispatchEvent(new Event("scroll"));
    });

    expect(result.current.visible).toBe(false);
  });

  it("does not become visible from scrolling alone when not hovered", () => {
    const container = createScrollContainer({ clientHeight: 100, scrollHeight: 300, scrollTop: 24 });
    const containerRef = { current: container };
    const { result } = renderHook(() => useOverlayScrollbar(containerRef));

    act(() => {
      container.dispatchEvent(new Event("scroll"));
    });

    expect(result.current.visible).toBe(false);
  });
});
