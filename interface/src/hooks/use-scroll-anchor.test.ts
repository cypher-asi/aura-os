import { renderHook, act } from "@testing-library/react";
import { useScrollAnchor } from "./use-scroll-anchor";

class MockMutationObserver {
  callback: MutationCallback;
  static instances: MockMutationObserver[] = [];
  constructor(callback: MutationCallback) {
    this.callback = callback;
    MockMutationObserver.instances.push(this);
  }
  observe = vi.fn();
  disconnect = vi.fn();
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

const DEFAULT_OPTIONS = { resetKey: "default" };
const NULL_SENTINEL: React.RefObject<HTMLElement | null> = { current: null };

describe("useScrollAnchor", () => {
  let origMO: typeof MutationObserver;
  let origRO: typeof ResizeObserver;
  let origRAF: typeof requestAnimationFrame;
  let origCAF: typeof cancelAnimationFrame;
  let rafQueue: Map<number, FrameRequestCallback>;
  let nextRafId: number;

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

  function containerRO(round = 0): MockResizeObserver {
    return MockResizeObserver.instances[round * 2];
  }

  function contentRO(round = 0): MockResizeObserver {
    return MockResizeObserver.instances[round * 2 + 1];
  }

  function renderActive(elOverrides: Parameters<typeof makeEl>[0] = {}) {
    const el = makeEl(elOverrides);
    const ref = { current: el };
    const hook = renderHook(
      ({ resetKey }: { resetKey: string }) =>
        useScrollAnchor(ref, NULL_SENTINEL, { resetKey }),
      { initialProps: { resetKey: "default" } },
    );
    act(() => flushRafs());
    return { el, ref, ...hook };
  }

  beforeEach(() => {
    origMO = globalThis.MutationObserver;
    origRO = globalThis.ResizeObserver;
    origRAF = globalThis.requestAnimationFrame;
    origCAF = globalThis.cancelAnimationFrame;
    MockMutationObserver.instances = [];
    MockResizeObserver.instances = [];
    globalThis.MutationObserver = MockMutationObserver as unknown as typeof MutationObserver;
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
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
    globalThis.MutationObserver = origMO;
    globalThis.ResizeObserver = origRO;
    globalThis.requestAnimationFrame = origRAF;
    globalThis.cancelAnimationFrame = origCAF;
  });

  it("returns the active scroll API", () => {
    const ref = { current: makeEl() };
    const { result } = renderHook(() => useScrollAnchor(ref, NULL_SENTINEL, DEFAULT_OPTIONS));
    expect(typeof result.current.handleScroll).toBe("function");
    expect(typeof result.current.scrollToBottom).toBe("function");
    expect(typeof result.current.scrollToBottomIfPinned).toBe("function");
    expect(typeof result.current.isAutoFollowing).toBe("boolean");
  });

  it("starts pinned and scrolls to bottom on mount", () => {
    const { el, result } = renderActive({ scrollTop: 100 });
    expect(result.current.isAutoFollowing).toBe(true);
    expect(el.scrollTop).toBe(1000);
  });

  it("scrolls to bottom on mutation when pinned", () => {
    const { el } = renderActive();
    (el as any).scrollHeight = 1400;
    act(() => {
      latestMO().trigger();
      flushRafs();
    });
    expect(el.scrollTop).toBe(1400);
  });

  it("does not auto-follow when the user scrolls up", () => {
    const { el, result } = renderActive();
    (el as any).scrollTop = 100;
    act(() => result.current.handleScroll());
    expect(result.current.isAutoFollowing).toBe(false);

    (el as any).scrollHeight = 1400;
    act(() => {
      latestMO().trigger();
      flushRafs();
    });
    expect(el.scrollTop).toBe(100);
  });

  it("scrollToBottom re-enables auto-follow", () => {
    const { el, result } = renderActive();
    (el as any).scrollTop = 100;
    act(() => result.current.handleScroll());

    act(() => result.current.scrollToBottom());
    expect(result.current.isAutoFollowing).toBe(true);
    expect(el.scrollTop).toBe(1000);
  });

  it("scrollToBottomIfPinned preserves a user-scrolled position", () => {
    const { el, result } = renderActive();
    (el as any).scrollTop = 100;
    act(() => result.current.handleScroll());

    (el as any).scrollHeight = 2000;
    act(() => result.current.scrollToBottomIfPinned());
    expect(el.scrollTop).toBe(100);
  });

  it("re-anchors to the bottom when resetKey changes", () => {
    const { el, result, rerender } = renderActive({ scrollTop: 100 });
    (el as any).scrollTop = 150;
    act(() => result.current.handleScroll());
    expect(result.current.isAutoFollowing).toBe(false);

    (el as any).scrollHeight = 1600;
    rerender({ resetKey: "next" });
    act(() => flushRafs());

    expect(result.current.isAutoFollowing).toBe(true);
    expect(el.scrollTop).toBe(1600);
  });

  it("observes container and content resizes", () => {
    renderActive();
    expect(MockMutationObserver.instances).toHaveLength(1);
    expect(MockResizeObserver.instances).toHaveLength(2);
  });

  it("preserves scroll position on width change when auto-follow is disabled", () => {
    const { el, result } = renderActive({ clientWidth: 300 });
    (el as any).scrollTop = 100;
    act(() => result.current.handleScroll());

    (el as any).clientWidth = 500;
    (el as any).scrollHeight = 2000;
    act(() => {
      containerRO().trigger();
      flushRafs();
    });

    expect(el.scrollTop).toBe(100);
  });

  it("scrolls to bottom on content resize when pinned", () => {
    const el = makeEl();
    const child = document.createElement("div");
    el.appendChild(child);
    const ref = { current: el };
    const { result } = renderHook(() => useScrollAnchor(ref, NULL_SENTINEL, DEFAULT_OPTIONS));
    act(() => flushRafs());

    (el as any).scrollHeight = 1800;
    act(() => {
      contentRO().trigger();
      flushRafs();
    });

    expect(result.current.isAutoFollowing).toBe(true);
    expect(el.scrollTop).toBe(1800);
  });
});
