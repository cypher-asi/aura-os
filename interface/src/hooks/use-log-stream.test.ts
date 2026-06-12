import { renderHook, act } from "@testing-library/react";
import { useLogStream } from "./use-log-stream";

type SubscribeCallback = (event: Record<string, unknown>) => void;

const subscribeMap = new Map<string, Set<SubscribeCallback>>();

vi.mock("../stores/event-store/index", () => ({
  useEventStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      subscribe: (type: string, cb: SubscribeCallback) => {
        if (!subscribeMap.has(type)) subscribeMap.set(type, new Set());
        subscribeMap.get(type)!.add(cb);
        return () => subscribeMap.get(type)!.delete(cb);
      },
      connected: true,
    }),
}));

vi.mock("../api/client", () => ({
  api: {
    getLogEntries: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../shared/utils/format", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../shared/utils/format")>();
  return { ...orig, formatTime: vi.fn(() => "12:00:00") };
});

describe("useLogStream", () => {
  beforeEach(() => {
    subscribeMap.clear();
  });

  it("returns empty entries initially", () => {
    const { result } = renderHook(() => useLogStream());
    expect(result.current.entries).toEqual([]);
    expect(result.current.connected).toBe(true);
  });

  it("adds entries from subscribed events", () => {
    const { result } = renderHook(() => useLogStream());

    act(() => {
      const cbs = subscribeMap.get("loop_started");
      cbs?.forEach((cb) => cb({ type: "loop_started" }));
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].type).toBe("loop_started");
    expect(result.current.entries[0].summary).toBe("Dev loop started");
  });

  it("summarises task_completed events", () => {
    const { result } = renderHook(() => useLogStream());

    act(() => {
      subscribeMap.get("task_completed")?.forEach((cb) =>
        cb({
          type: "task_completed",
          content: { task_id: "t-1", task_title: "Test Task" },
        }),
      );
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].summary).toContain("Completed: Test Task");
  });

  it("summarises task_failed with reason", () => {
    const { result } = renderHook(() => useLogStream());

    act(() => {
      subscribeMap.get("task_failed")?.forEach((cb) =>
        cb({
          type: "task_failed",
          content: { task_id: "t-1", task_title: "Fail Task", reason: "timeout" },
        }),
      );
    });

    expect(result.current.entries[0].summary).toContain("Failed: Fail Task");
    expect(result.current.entries[0].summary).toContain("timeout");
  });

  it("summarises build events", () => {
    const { result } = renderHook(() => useLogStream());

    act(() => {
      subscribeMap.get("build_verification_passed")?.forEach((cb) =>
        cb({ type: "build_verification_passed", content: { duration_ms: 1500 } }),
      );
    });

    expect(result.current.entries[0].summary).toContain("Build passed");
  });

  it("subscribes to the engine event types but not chat noise", () => {
    // EVENT_LABELS now covers every EventType (it also drives the log
    // badge categories), while the log stream itself subscribes to the
    // curated engine set only — chat deltas would flood the log.
    renderHook(() => useLogStream());

    const expectedTypes = [
      "loop_started",
      "loop_finished",
      "task_started",
      "task_completed",
      "task_failed",
      "build_verification_passed",
      "git_committed",
      "error",
    ];
    for (const type of expectedTypes) {
      expect(subscribeMap.has(type)).toBe(true);
    }
    expect(subscribeMap.has("delta")).toBe(false);
    expect(subscribeMap.has("thinking_delta")).toBe(false);
  });

  it("provides contentRef and handleScroll", () => {
    const { result } = renderHook(() => useLogStream());

    expect(result.current.contentRef).toBeDefined();
    expect(typeof result.current.handleScroll).toBe("function");
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = renderHook(() => useLogStream());

    unmount();

    for (const cbs of subscribeMap.values()) {
      expect(cbs.size).toBe(0);
    }
  });
});
