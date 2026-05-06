import { renderHook, act } from "@testing-library/react";
import { useDeferredModalOpen } from "./use-deferred-modal-open";

describe("useDeferredModalOpen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts closed and not preparing when requestedOpen is false", () => {
    const { result } = renderHook(() =>
      useDeferredModalOpen({ requestedOpen: false }),
    );
    expect(result.current).toEqual({ isOpen: false, isPreparing: false });
  });

  it("opens synchronously when there is no prepare function", () => {
    const { result, rerender } = renderHook(
      ({ requestedOpen }: { requestedOpen: boolean }) =>
        useDeferredModalOpen({ requestedOpen }),
      { initialProps: { requestedOpen: false } },
    );

    rerender({ requestedOpen: true });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.isPreparing).toBe(false);
  });

  it("preps then opens once prepare resolves", async () => {
    let resolvePrepare!: () => void;
    const prepare = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePrepare = resolve;
        }),
    );

    const { result, rerender } = renderHook(
      ({ requestedOpen }: { requestedOpen: boolean }) =>
        useDeferredModalOpen({ requestedOpen, prepare }),
      { initialProps: { requestedOpen: false } },
    );

    rerender({ requestedOpen: true });

    expect(result.current).toEqual({ isOpen: false, isPreparing: true });
    expect(prepare).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePrepare();
    });

    expect(result.current).toEqual({ isOpen: true, isPreparing: false });
  });

  it("opens even if prepare rejects", async () => {
    let rejectPrepare!: (err: Error) => void;
    const prepare = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          rejectPrepare = reject;
        }),
    );

    const { result, rerender } = renderHook(
      ({ requestedOpen }: { requestedOpen: boolean }) =>
        useDeferredModalOpen({ requestedOpen, prepare }),
      { initialProps: { requestedOpen: false } },
    );

    rerender({ requestedOpen: true });
    expect(result.current.isPreparing).toBe(true);

    await act(async () => {
      rejectPrepare(new Error("boom"));
    });

    expect(result.current).toEqual({ isOpen: true, isPreparing: false });
  });

  it("opens after timeoutMs even if prepare never settles", async () => {
    const prepare = vi.fn(() => new Promise<void>(() => {}));

    const { result, rerender } = renderHook(
      ({ requestedOpen }: { requestedOpen: boolean }) =>
        useDeferredModalOpen({ requestedOpen, prepare, timeoutMs: 250 }),
      { initialProps: { requestedOpen: false } },
    );

    rerender({ requestedOpen: true });
    expect(result.current.isPreparing).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(result.current).toEqual({ isOpen: true, isPreparing: false });
  });

  it("closes immediately when requestedOpen flips to false", async () => {
    let resolvePrepare!: () => void;
    const prepare = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePrepare = resolve;
        }),
    );

    const { result, rerender } = renderHook(
      ({ requestedOpen }: { requestedOpen: boolean }) =>
        useDeferredModalOpen({ requestedOpen, prepare }),
      { initialProps: { requestedOpen: true } },
    );

    await act(async () => {
      resolvePrepare();
    });
    expect(result.current.isOpen).toBe(true);

    rerender({ requestedOpen: false });
    expect(result.current).toEqual({ isOpen: false, isPreparing: false });
  });

  it("ignores a stale prepare resolution from a previous open cycle", async () => {
    const resolves: Array<() => void> = [];
    const prepare = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolves.push(resolve);
        }),
    );

    const { result, rerender } = renderHook(
      ({ requestedOpen }: { requestedOpen: boolean }) =>
        useDeferredModalOpen({ requestedOpen, prepare }),
      { initialProps: { requestedOpen: false } },
    );

    rerender({ requestedOpen: true });
    expect(result.current.isPreparing).toBe(true);

    rerender({ requestedOpen: false });
    expect(result.current).toEqual({ isOpen: false, isPreparing: false });

    rerender({ requestedOpen: true });
    expect(prepare).toHaveBeenCalledTimes(2);

    // Stale resolution from cycle #1 fires AFTER cycle #2 has started.
    // It must not flip isOpen / isPreparing for cycle #2.
    await act(async () => {
      resolves[0]?.();
    });
    expect(result.current).toEqual({ isOpen: false, isPreparing: true });

    await act(async () => {
      resolves[1]?.();
    });
    expect(result.current).toEqual({ isOpen: true, isPreparing: false });
  });

  it("uses the latest prepare reference without restarting on every render", async () => {
    const prepareA = vi.fn(() => Promise.resolve());
    const prepareB = vi.fn(() => Promise.resolve());

    const { rerender } = renderHook(
      ({ requestedOpen, prepare }: {
        requestedOpen: boolean;
        prepare: () => Promise<void>;
      }) => useDeferredModalOpen({ requestedOpen, prepare }),
      { initialProps: { requestedOpen: false, prepare: prepareA } },
    );

    rerender({ requestedOpen: false, prepare: prepareB });
    expect(prepareA).not.toHaveBeenCalled();
    expect(prepareB).not.toHaveBeenCalled();

    rerender({ requestedOpen: true, prepare: prepareB });
    await act(async () => {
      await Promise.resolve();
    });
    expect(prepareA).not.toHaveBeenCalled();
    expect(prepareB).toHaveBeenCalledTimes(1);
  });
});
