import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useImageScrollPin } from "./use-image-scroll-pin";

function makeContainer(overrides: {
  scrollTop?: number;
  scrollHeight?: number;
  clientHeight?: number;
} = {}): HTMLDivElement {
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
  // Hook observes el.firstElementChild via ResizeObserver. Provide an
  // inner wrapper so the hook has a target to observe.
  const inner = document.createElement("div");
  container.appendChild(inner);
  document.body.appendChild(container);
  return container;
}

function fireImageLoad(container: HTMLElement): void {
  const img = document.createElement("img");
  // Image is appended somewhere inside the scroll container so the
  // capture-phase listener on the scroll container fires.
  container.firstElementChild!.appendChild(img);
  img.dispatchEvent(new Event("load", { bubbles: false }));
}

const triggerResize = vi.fn();

class MockResizeObserver {
  callback: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.callback = cb;
    triggerResize.mockImplementation(() => {
      cb([], this as unknown as ResizeObserver);
    });
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe("useImageScrollPin", () => {
  beforeEach(() => {
    triggerResize.mockReset();
    (
      globalThis as unknown as { ResizeObserver: typeof ResizeObserver }
    ).ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("re-pins to bottom when an image loads while auto-following", () => {
    const container = makeContainer({ scrollTop: 100, scrollHeight: 2000, clientHeight: 400 });
    const ref = { current: container };

    renderHook(() => useImageScrollPin(ref, { isAutoFollowing: true }));

    act(() => fireImageLoad(container));
    expect(container.scrollTop).toBe(2000);
  });

  it("re-pins when ResizeObserver fires (e.g. content grows due to image decode)", () => {
    const container = makeContainer({ scrollTop: 100, scrollHeight: 2000, clientHeight: 400 });
    const ref = { current: container };

    renderHook(() => useImageScrollPin(ref, { isAutoFollowing: true }));

    act(() => triggerResize());
    expect(container.scrollTop).toBe(2000);
  });

  it("does NOT scroll when the user is no longer auto-following", () => {
    const container = makeContainer({ scrollTop: 100, scrollHeight: 2000, clientHeight: 400 });
    const ref = { current: container };

    renderHook(() => useImageScrollPin(ref, { isAutoFollowing: false }));

    act(() => fireImageLoad(container));
    act(() => triggerResize());
    expect(container.scrollTop).toBe(100);
  });

  it("re-pins during the initial reveal window even if not auto-following", () => {
    const container = makeContainer({ scrollTop: 100, scrollHeight: 2000, clientHeight: 400 });
    const ref = { current: container };

    renderHook(() =>
      useImageScrollPin(ref, {
        isAutoFollowing: false,
        initialRevealUntil: Date.now() + 1000,
      }),
    );

    act(() => triggerResize());
    expect(container.scrollTop).toBe(2000);
  });

  it("ignores load events from non-image elements", () => {
    const container = makeContainer({ scrollTop: 100, scrollHeight: 2000, clientHeight: 400 });
    const ref = { current: container };

    renderHook(() => useImageScrollPin(ref, { isAutoFollowing: true }));

    const iframe = document.createElement("iframe");
    container.firstElementChild!.appendChild(iframe);
    act(() => {
      iframe.dispatchEvent(new Event("load", { bubbles: false }));
    });

    expect(container.scrollTop).toBe(100);
  });

  it("does nothing when already pinned to the bottom", () => {
    const container = makeContainer({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 });
    const ref = { current: container };

    renderHook(() => useImageScrollPin(ref, { isAutoFollowing: true }));

    act(() => triggerResize());
    expect(container.scrollTop).toBe(600);
  });
});
