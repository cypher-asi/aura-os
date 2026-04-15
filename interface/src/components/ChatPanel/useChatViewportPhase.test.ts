import { renderHook, act } from "@testing-library/react";
import { useChatViewportPhase } from "./useChatViewportPhase";

describe("useChatViewportPhase", () => {
  let rafQueue: Map<number, FrameRequestCallback>;
  let nextRafId: number;
  let origRAF: typeof requestAnimationFrame;
  let origCAF: typeof cancelAnimationFrame;

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

  function makeContainer() {
    const el = document.createElement("div");
    Object.defineProperties(el, {
      scrollHeight: { value: 1000, writable: true, configurable: true },
      scrollTop: { value: 600, writable: true, configurable: true },
      clientHeight: { value: 400, writable: true, configurable: true },
    });
    return el;
  }

  beforeEach(() => {
    origRAF = globalThis.requestAnimationFrame;
    origCAF = globalThis.cancelAnimationFrame;
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
    globalThis.requestAnimationFrame = origRAF;
    globalThis.cancelAnimationFrame = origCAF;
  });

  it("reveals immediately once content is ready and there are no messages", () => {
    const containerRef = { current: makeContainer() };
    const sentinelRef = { current: null };
    const scrollToBottom = vi.fn();

    const { result } = renderHook(() => useChatViewportPhase({
      contentReady: true,
      hasMessages: false,
      tailLayoutReady: false,
      layoutRevision: 0,
      scrollToBottom,
      containerRef,
      sentinelRef,
    }));

    expect(result.current.isReady).toBe(true);
    expect(scrollToBottom).not.toHaveBeenCalled();
  });

  it("waits for tail layout readiness before revealing message history", () => {
    const containerRef = { current: makeContainer() };
    const sentinelRef = { current: null };
    const scrollToBottom = vi.fn(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop = 1000;
      }
    });

    const { result, rerender } = renderHook(
      (props: { tailLayoutReady: boolean; layoutRevision: number }) => useChatViewportPhase({
        contentReady: true,
        hasMessages: true,
        tailLayoutReady: props.tailLayoutReady,
        layoutRevision: props.layoutRevision,
        scrollToBottom,
        containerRef,
        sentinelRef,
      }),
      { initialProps: { tailLayoutReady: false, layoutRevision: 0 } },
    );

    expect(result.current.isReady).toBe(false);

    rerender({ tailLayoutReady: true, layoutRevision: 1 });
    act(() => flushRafs());

    expect(result.current.isReady).toBe(true);
    expect(scrollToBottom).toHaveBeenCalled();
  });

  it("resets to hidden when the conversation key changes", () => {
    const containerRef = { current: makeContainer() };
    const sentinelRef = { current: null };
    const scrollToBottom = vi.fn(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop = 1000;
      }
    });

    const { result, rerender } = renderHook(
      ({ resetKey, layoutRevision }: { resetKey: string; layoutRevision: number }) => useChatViewportPhase({
        resetKey,
        contentReady: true,
        hasMessages: true,
        tailLayoutReady: true,
        layoutRevision,
        scrollToBottom,
        containerRef,
        sentinelRef,
      }),
      { initialProps: { resetKey: "a", layoutRevision: 1 } },
    );

    act(() => flushRafs());
    expect(result.current.isReady).toBe(true);

    rerender({ resetKey: "b", layoutRevision: 0 });
    expect(result.current.isReady).toBe(false);

    rerender({ resetKey: "b", layoutRevision: 1 });
    act(() => flushRafs());
    expect(result.current.isReady).toBe(true);
  });

  it("stays revealed after transient layout or history regressions", () => {
    const containerRef = { current: makeContainer() };
    const sentinelRef = { current: null };
    const scrollToBottom = vi.fn(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop = 1000;
      }
    });

    const { result, rerender } = renderHook(
      (props: {
        contentReady: boolean;
        tailLayoutReady: boolean;
        layoutRevision: number;
      }) => useChatViewportPhase({
        contentReady: props.contentReady,
        hasMessages: true,
        tailLayoutReady: props.tailLayoutReady,
        layoutRevision: props.layoutRevision,
        scrollToBottom,
        containerRef,
        sentinelRef,
      }),
      { initialProps: { contentReady: true, tailLayoutReady: true, layoutRevision: 1 } },
    );

    act(() => flushRafs());
    expect(result.current.isReady).toBe(true);
    const callCountAfterReveal = scrollToBottom.mock.calls.length;

    rerender({ contentReady: false, tailLayoutReady: false, layoutRevision: 2 });

    expect(result.current.isReady).toBe(true);
    expect(scrollToBottom).toHaveBeenCalledTimes(callCountAfterReveal);
  });
});
