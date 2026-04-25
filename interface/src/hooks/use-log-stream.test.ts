import { renderHook, act } from "@testing-library/react";
import { useLogStream, EVENT_LABELS } from "./use-log-stream";

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
        cb({ type: "task_completed", task_id: "t-1", task_title: "Test Task" }),
      );
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].summary).toContain("Completed: Test Task");
  });

  it("summarises task_failed with reason", () => {
    const { result } = renderHook(() => useLogStream());

    act(() => {
      subscribeMap.get("task_failed")?.forEach((cb) =>
        cb({ type: "task_failed", task_id: "t-1", task_title: "Fail Task", reason: "timeout" }),
      );
    });

    expect(result.current.entries[0].summary).toContain("Failed: Fail Task");
    expect(result.current.entries[0].summary).toContain("timeout");
  });

  it("summarises build events", () => {
    const { result } = renderHook(() => useLogStream());

    act(() => {
      subscribeMap.get("build_verification_passed")?.forEach((cb) =>
        cb({ type: "build_verification_passed", duration_ms: 1500 }),
      );
    });

    expect(result.current.entries[0].summary).toContain("Build passed");
  });

  it("subscribes to all event types", () => {
    renderHook(() => useLogStream());

    const expectedTypes = Object.keys(EVENT_LABELS);
    for (const type of expectedTypes) {
      expect(subscribeMap.has(type)).toBe(true);
    }
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
