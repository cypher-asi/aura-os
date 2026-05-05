import { act, renderHook } from "@testing-library/react";
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
  return container;
}

function fireImageLoad(container: HTMLElement): void {
  const img = document.createElement("img");
  container.appendChild(img);
  // The hook attaches a capturing `load` listener on the container, so a
  // bubbleless `load` event dispatched on the descendant must reach it
  // via capture phase.
  img.dispatchEvent(new Event("load", { bubbles: false }));
}

describe("useImageScrollPin", () => {
  it("re-pins to bottom when an image loads while auto-following", () => {
    const container = makeContainer({ scrollTop: 100, scrollHeight: 2000, clientHeight: 400 });
    const ref = { current: container };

    renderHook(() => useImageScrollPin(ref, { isAutoFollowing: true }));

    act(() => fireImageLoad(container));
    expect(container.scrollTop).toBe(2000);
  });

  it("does NOT scroll when the user is no longer auto-following", () => {
    const container = makeContainer({ scrollTop: 100, scrollHeight: 2000, clientHeight: 400 });
    const ref = { current: container };

    renderHook(() => useImageScrollPin(ref, { isAutoFollowing: false }));

    act(() => fireImageLoad(container));
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

    act(() => fireImageLoad(container));
    expect(container.scrollTop).toBe(2000);
  });

  it("ignores load events from non-image elements", () => {
    const container = makeContainer({ scrollTop: 100, scrollHeight: 2000, clientHeight: 400 });
    const ref = { current: container };

    renderHook(() => useImageScrollPin(ref, { isAutoFollowing: true }));

    const iframe = document.createElement("iframe");
    container.appendChild(iframe);
    act(() => {
      iframe.dispatchEvent(new Event("load", { bubbles: false }));
    });

    expect(container.scrollTop).toBe(100);
  });
});
