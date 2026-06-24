import { renderHook, act } from "@testing-library/react";
import {
  useStreamStore,
  streamMetaMap,
  ensureEntry,
  createSetters,
  markStreamProgress,
} from "./store";
import {
  useStreamHealth,
  useStuckStreamAutoTimeout,
  STUCK_THRESHOLD_MS,
  ABSOLUTE_TIMEOUT_MS,
} from "./use-stream-health";

describe("useStreamHealth", () => {
  beforeEach(() => {
    streamMetaMap.clear();
    useStreamStore.setState({ entries: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports not stuck when stream is idle", () => {
    ensureEntry("k1");
    const { result } = renderHook(() => useStreamHealth("k1"));
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.isStuck).toBe(false);
    expect(result.current.lastEventAgeMs).toBeNull();
    expect(result.current.stuckForMs).toBeNull();
  });

  it("reports not stuck while events are landing within the threshold", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    setters.setIsStreaming(true);
    setters.setStreamingText("hello");

    const { result } = renderHook(() => useStreamHealth("k1"));
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.lastEventAgeMs).toBe(0);
    expect(result.current.isStuck).toBe(false);

    // Advance 5s — well below the 30s threshold.
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current.isStuck).toBe(false);
    expect(result.current.lastEventAgeMs).toBe(5_000);
  });

  it("flips to stuck after the threshold elapses without a fresh event", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    setters.setIsStreaming(true);
    setters.setStreamingText("hello");

    const { result } = renderHook(() => useStreamHealth("k1"));
    expect(result.current.isStuck).toBe(false);

    // Push past the stuck threshold. The interval ticker is what
    // forces the re-render even though no setter ran during the gap.
    act(() => {
      vi.advanceTimersByTime(STUCK_THRESHOLD_MS + 1_000);
    });

    expect(result.current.isStuck).toBe(true);
    expect(result.current.lastEventAgeMs).toBeGreaterThanOrEqual(
      STUCK_THRESHOLD_MS,
    );
    expect(result.current.stuckForMs).toBeGreaterThanOrEqual(0);
  });

  it("clears stuck status when a fresh event arrives", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    setters.setIsStreaming(true);
    setters.setStreamingText("hello");

    const { result } = renderHook(() => useStreamHealth("k1"));

    act(() => {
      vi.advanceTimersByTime(STUCK_THRESHOLD_MS + 5_000);
    });
    expect(result.current.isStuck).toBe(true);

    // A new wire event should reset the clock.
    act(() => {
      setters.setStreamingText("hello world");
    });
    expect(result.current.isStuck).toBe(false);
    expect(result.current.lastEventAgeMs).toBe(0);
  });

  it("re-renders periodically while streaming so age advances without setter activity", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    setters.setIsStreaming(true);
    setters.setStreamingText("seed");

    const { result } = renderHook(() => useStreamHealth("k1"));
    expect(result.current.lastEventAgeMs).toBe(0);

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current.lastEventAgeMs).toBe(2_000);

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current.lastEventAgeMs).toBe(5_000);
  });

  it("stops ticking after streaming ends", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    setters.setIsStreaming(true);
    setters.setStreamingText("seed");

    const { result } = renderHook(() => useStreamHealth("k1"));
    expect(result.current.isStreaming).toBe(true);

    act(() => {
      setters.setIsStreaming(false);
    });
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.lastEventAgeMs).toBeNull();
    expect(result.current.isStuck).toBe(false);
  });

  it("does not report isStuck on the first render after a fresh send when prior lastEventAt is stale", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    // Simulate the warm-reopen scenario: a previous turn's last event was
    // 45 seconds ago (well past STUCK_THRESHOLD_MS), and the entry is not
    // currently streaming. This mirrors the user-reported "Agent paused
    // for 2s — last activity was 32s ago" pill that flashed instantly
    // when sending turn 2 on a warm-reopened session.
    useStreamStore.setState((s) => ({
      entries: {
        ...s.entries,
        k1: {
          ...s.entries["k1"],
          lastEventAt: Date.now() - 45_000,
          stuckSince: null,
          isStreaming: false,
        },
      },
    }));

    const setters = createSetters("k1");
    setters.setIsStreaming(true);

    const { result } = renderHook(() => useStreamHealth("k1"));
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.isStuck).toBe(false);
    expect(result.current.lastEventAgeMs).toBe(0);
  });
});

describe("useStuckStreamAutoTimeout", () => {
  beforeEach(() => {
    streamMetaMap.clear();
    useStreamStore.setState({ entries: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes onAutoTimeout exactly once when the stuck window crosses ABSOLUTE_TIMEOUT_MS", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    setters.setIsStreaming(true);
    setters.setStreamingText("seed");

    const onAutoTimeout = vi.fn();
    renderHook(() => {
      const health = useStreamHealth("k1");
      useStuckStreamAutoTimeout(health, onAutoTimeout);
    });

    // Below the timeout — no fire yet.
    act(() => {
      vi.advanceTimersByTime(STUCK_THRESHOLD_MS + 5_000);
    });
    expect(onAutoTimeout).not.toHaveBeenCalled();

    // Cross the absolute-timeout wall-clock threshold.
    act(() => {
      vi.advanceTimersByTime(ABSOLUTE_TIMEOUT_MS - (STUCK_THRESHOLD_MS + 5_000) + 500);
    });
    expect(onAutoTimeout).toHaveBeenCalledTimes(1);

    // Subsequent ticks within the same stuck episode must not re-fire.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onAutoTimeout).toHaveBeenCalledTimes(1);
  });

  it("does NOT auto-abort at the old 60s mark — only at the absolute safety cap", () => {
    // Pins the softening fix: the destructive auto-abort used to fire
    // at 60s of silence, pre-empting the graceful SSE-idle reattach and
    // killing (and billing) turns that were still alive. It must now
    // stay quiet well past 60s and only fire at ABSOLUTE_TIMEOUT_MS.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    setters.setIsStreaming(true);
    setters.setStreamingText("seed");

    const onAutoTimeout = vi.fn();
    renderHook(() => {
      const health = useStreamHealth("k1");
      useStuckStreamAutoTimeout(health, onAutoTimeout);
    });

    // Past the legacy 60s threshold (and well beyond) — must NOT fire.
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(onAutoTimeout).not.toHaveBeenCalled();

    // Reaching the absolute cap — now it fires exactly once.
    act(() => {
      vi.advanceTimersByTime(ABSOLUTE_TIMEOUT_MS - 120_000 + 500);
    });
    expect(onAutoTimeout).toHaveBeenCalledTimes(1);
  });

  it("re-arms after a fresh wire event so a second stuck episode also fires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    setters.setIsStreaming(true);
    setters.setStreamingText("seed");

    const onAutoTimeout = vi.fn();
    renderHook(() => {
      const health = useStreamHealth("k1");
      useStuckStreamAutoTimeout(health, onAutoTimeout);
    });

    act(() => {
      vi.advanceTimersByTime(ABSOLUTE_TIMEOUT_MS + 500);
    });
    expect(onAutoTimeout).toHaveBeenCalledTimes(1);

    // Fresh wire event resets the clock, then go silent again past
    // the absolute-timeout threshold.
    act(() => {
      setters.setStreamingText("seed-2");
    });
    act(() => {
      vi.advanceTimersByTime(ABSOLUTE_TIMEOUT_MS + 500);
    });
    expect(onAutoTimeout).toHaveBeenCalledTimes(2);
  });

  it("treats markStreamProgress as a wire event so partial-image-only streams do not auto-timeout", () => {
    // Regression guard for the GPT Image 2 watchdog timeout: the
    // chat-stream handlers no-op'd on `generation_partial_image`,
    // letting `useStuckStreamAutoTimeout` auto-abort a long
    // partial-image render whose `progress` events were sparser than
    // the timeout window. The handler now calls `markStreamProgress`
    // on each partial-image frame; this test pins that contract by
    // asserting the watchdog stays quiet when ONLY `markStreamProgress`
    // ticks land between the seed event and the would-be timeout.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    setters.setIsStreaming(true);
    setters.setStreamingText("seed");

    const onAutoTimeout = vi.fn();
    renderHook(() => {
      const health = useStreamHealth("k1");
      useStuckStreamAutoTimeout(health, onAutoTimeout);
    });

    // Walk PAST the absolute-timeout window in 30s slices, acking each
    // slice with a `markStreamProgress` (i.e. a partial-image SSE event
    // arrived but no setter ran). The total wall-clock deliberately
    // exceeds `ABSOLUTE_TIMEOUT_MS` so that, without the per-slice
    // resets, the watchdog WOULD fire — yet it must stay silent because
    // the wire-event clock keeps resetting.
    const slices = Math.ceil(ABSOLUTE_TIMEOUT_MS / 30_000) + 1;
    for (let slice = 0; slice < slices; slice += 1) {
      act(() => {
        vi.advanceTimersByTime(30_000);
        markStreamProgress("k1");
      });
    }
    expect(onAutoTimeout).not.toHaveBeenCalled();

    // Sanity-check the inverse: stop ticking the wire-event clock and
    // the watchdog still fires after 60s. This guarantees the test
    // above didn't pass for some unrelated reason (e.g. the watchdog
    // being globally disabled).
    act(() => {
      vi.advanceTimersByTime(ABSOLUTE_TIMEOUT_MS + 500);
    });
    expect(onAutoTimeout).toHaveBeenCalledTimes(1);
  });

  it("does not fire when streaming ends before the timeout elapses", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));

    ensureEntry("k1");
    const setters = createSetters("k1");
    setters.setIsStreaming(true);
    setters.setStreamingText("seed");

    const onAutoTimeout = vi.fn();
    renderHook(() => {
      const health = useStreamHealth("k1");
      useStuckStreamAutoTimeout(health, onAutoTimeout);
    });

    act(() => {
      vi.advanceTimersByTime(STUCK_THRESHOLD_MS + 5_000);
    });
    act(() => {
      setters.setIsStreaming(false);
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onAutoTimeout).not.toHaveBeenCalled();
  });
});
