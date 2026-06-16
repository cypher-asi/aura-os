import { renderHook, act } from "@testing-library/react";
import {
  useStreamStore,
  streamMetaMap,
  ensureEntry,
  createSetters,
} from "./store";
import { formatCountdown, useGenerationEta } from "./use-generation-eta";

describe("useGenerationEta", () => {
  beforeEach(() => {
    streamMetaMap.clear();
    useStreamStore.setState({ entries: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when no generation is in flight on the entry", () => {
    ensureEntry("k1");
    const { result } = renderHook(() => useGenerationEta("k1"));
    expect(result.current).toBeNull();
  });

  it("seeds the per-model fallback estimate", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    act(() => {
      setters.setGenerationState({
        startedAt: Date.now(),
        model: "gpt-image-2",
        kind: "image",
      });
    });

    const { result } = renderHook(() => useGenerationEta("k1"));

    // gpt-image-2 -> 120_000ms fallback. At t=0 we expect ~120s remaining.
    expect(result.current).not.toBeNull();
    expect(result.current?.kind).toBe("image");
    expect(result.current?.overrun).toBe(false);
    expect(result.current?.remainingMs).toBe(120_000);
  });

  it("counts down via the 1s ticker as wall-clock time elapses", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    act(() => {
      setters.setGenerationState({
        startedAt: Date.now(),
        model: "gemini-nano-banana",
        kind: "image",
      });
    });

    const { result } = renderHook(() => useGenerationEta("k1"));
    // gemini-nano-banana baseline: 25_000ms.
    expect(result.current?.remainingMs).toBe(25_000);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current?.remainingMs).toBe(20_000);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current?.remainingMs).toBe(10_000);
  });

  it("falls back to the default estimate when the model id is unknown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    act(() => {
      setters.setGenerationState({
        startedAt: Date.now(),
        model: "no-such-model",
        kind: "image",
      });
    });

    const { result } = renderHook(() => useGenerationEta("k1"));
    expect(result.current?.remainingMs).toBe(30_000);
  });

  it("ignores generation_progress percent frames so the countdown never snaps", () => {
    // Regression for "countdown jumps from random numbers to Almost
    // done…": upstream `gpt-image-2` emits sparse percent frames that
    // don't track wall-clock progress, so the ETA must stay on the
    // per-model baseline regardless of what `setGenerationPercent`
    // pushes into the store.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    act(() => {
      setters.setGenerationState({
        startedAt: Date.now(),
        model: "gpt-image-2",
        kind: "image",
      });
    });

    const { result } = renderHook(() => useGenerationEta("k1"));
    expect(result.current?.remainingMs).toBe(120_000);

    // A noisy 50% at t=5s would have projected a 10s total under the
    // old adaptive formula and snapped the digits from 1:55 to 0:05.
    // The countdown must keep ticking against the 120s baseline.
    act(() => {
      vi.advanceTimersByTime(5_000);
      setters.setGenerationPercent(50);
    });
    expect(result.current?.remainingMs).toBe(115_000);
    expect(result.current?.overrun).toBe(false);

    // Even a near-completion percent value can't ratchet the projection.
    act(() => {
      setters.setGenerationPercent(95);
    });
    expect(result.current?.remainingMs).toBe(115_000);
    expect(result.current?.overrun).toBe(false);
  });

  it("resets the countdown when a new generation run starts on the same entry", () => {
    // Without resetting on `startedAt` change, a quick second send
    // (e.g. user retries an image) would inherit the previous run's
    // overrun state and read as "Almost done…" the moment the new
    // countdown mounted.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    act(() => {
      setters.setGenerationState({
        startedAt: Date.now(),
        model: "gemini-nano-banana",
        kind: "image",
      });
    });

    const { result } = renderHook(() => useGenerationEta("k1"));

    // Burn the first run down to overrun.
    act(() => {
      vi.advanceTimersByTime(25_000);
    });
    expect(result.current?.overrun).toBe(true);

    // Start a brand-new run on the same key.
    act(() => {
      setters.setGenerationState({
        startedAt: Date.now(),
        model: "gemini-nano-banana",
        kind: "image",
      });
    });
    expect(result.current?.overrun).toBe(false);
    expect(result.current?.remainingMs).toBe(25_000);
  });

  it("flags overrun once the estimate has elapsed but generation has not cleared", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    act(() => {
      setters.setGenerationState({
        startedAt: Date.now(),
        model: "gpt-image-1",
        kind: "image",
      });
    });

    const { result } = renderHook(() => useGenerationEta("k1"));
    // gpt-image-1 baseline: 30_000ms.
    act(() => {
      vi.advanceTimersByTime(35_000);
    });
    expect(result.current?.overrun).toBe(true);
    expect(result.current?.remainingMs).toBe(0);
  });

  it("returns null after clearGeneration runs (terminal events)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    act(() => {
      setters.setGenerationState({
        startedAt: Date.now(),
        model: "gpt-image-1",
        kind: "image",
      });
    });

    const { result } = renderHook(() => useGenerationEta("k1"));
    expect(result.current).not.toBeNull();

    act(() => {
      setters.clearGeneration();
    });
    expect(result.current).toBeNull();
  });
});

describe("formatCountdown", () => {
  it("formats sub-minute durations as 0:ss with leading zero", () => {
    expect(formatCountdown(42_000)).toBe("0:42");
    expect(formatCountdown(5_000)).toBe("0:05");
  });

  it("rounds up partial seconds so the digit stays visible for its full second", () => {
    // 100ms left should still read 0:01, not flash 0:00.
    expect(formatCountdown(100)).toBe("0:01");
    expect(formatCountdown(999)).toBe("0:01");
  });

  it("formats multi-minute durations as m:ss", () => {
    expect(formatCountdown(65_000)).toBe("1:05");
    expect(formatCountdown(125_000)).toBe("2:05");
  });

  it("clamps negative values to 0:00", () => {
    expect(formatCountdown(-500)).toBe("0:00");
  });
});
