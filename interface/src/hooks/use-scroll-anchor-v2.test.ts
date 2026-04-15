import { act, renderHook } from "@testing-library/react";
import { vi } from "vitest";
import { useScrollAnchorV2 } from "./use-scroll-anchor-v2";

function makeRect(top: number, bottom: number): DOMRect {
  return {
    x: 0,
    y: top,
    width: 300,
    height: bottom - top,
    top,
    right: 300,
    bottom,
    left: 0,
    toJSON: () => ({}),
  } as DOMRect;
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
    const container = document.createElement("div");
    Object.defineProperties(container, {
      scrollHeight: { value: 1000, writable: true, configurable: true },
      scrollTop: { value: 100, writable: true, configurable: true },
      clientHeight: { value: 400, writable: true, configurable: true },
    });

    const ref = { current: container };
    const { result } = renderHook(() => useScrollAnchorV2(ref, { resetKey: "thread-1" }));

    expect(result.current.isAutoFollowing).toBe(true);
    expect(container.scrollTop).toBe(1000);
  });

  it("restores the current anchor when content height changes while reading older messages", () => {
    const container = document.createElement("div");
    const anchor = document.createElement("div");
    anchor.setAttribute("data-message-id", "message-1");
    container.appendChild(anchor);

    Object.defineProperties(container, {
      scrollHeight: { value: 1000, writable: true, configurable: true },
      scrollTop: { value: 100, writable: true, configurable: true },
      clientHeight: { value: 400, writable: true, configurable: true },
    });

    container.getBoundingClientRect = vi.fn(() => makeRect(0, 400));

    let anchorTop = 50;
    anchor.getBoundingClientRect = vi.fn(() => makeRect(anchorTop, anchorTop + 40));

    const ref = { current: container };
    const { result } = renderHook(() => useScrollAnchorV2(ref, { resetKey: "thread-1" }));

    act(() => {
      container.scrollTop = 100;
      result.current.handleScroll();
    });

    anchorTop = 90;

    act(() => {
      result.current.onContentHeightChange({ immediate: true });
    });

    expect(result.current.isAutoFollowing).toBe(false);
    expect(container.scrollTop).toBe(140);
  });

  it("defers resize-session anchor restoration until a settled measurement pass runs", () => {
    const container = document.createElement("div");
    const anchor = document.createElement("div");
    anchor.setAttribute("data-message-id", "message-1");
    container.appendChild(anchor);

    Object.defineProperties(container, {
      scrollHeight: { value: 1000, writable: true, configurable: true },
      scrollTop: { value: 100, writable: true, configurable: true },
      clientHeight: { value: 400, writable: true, configurable: true },
    });

    container.getBoundingClientRect = vi.fn(() => makeRect(0, 400));

    let anchorTop = 50;
    anchor.getBoundingClientRect = vi.fn(() => makeRect(anchorTop, anchorTop + 40));

    const ref = { current: container };
    const { result, rerender } = renderHook(
      ({ resizeSession }) => useScrollAnchorV2(ref, {
        resetKey: "thread-1",
        resizeSession,
      }),
      {
        initialProps: {
          resizeSession: { isActive: false, settledAt: 0 },
        },
      },
    );

    act(() => {
      container.scrollTop = 100;
      result.current.handleScroll();
    });

    rerender({ resizeSession: { isActive: true, settledAt: 0 } });
    anchorTop = 90;

    act(() => {
      result.current.onContentHeightChange({ immediate: true });
    });

    expect(container.scrollTop).toBe(100);

    rerender({ resizeSession: { isActive: false, settledAt: 1 } });

    act(() => {
      result.current.onContentHeightChange({ immediate: true });
    });

    expect(container.scrollTop).toBe(140);
  });
});
