import { renderHook, act } from "@testing-library/react";
import { useCooldownStatus, cooldownLabel } from "./use-cooldown-status";
import { EventType } from "../types/aura-events";

type SubscribeCallback = (event: {
  type: EventType;
  project_id?: string;
  agent_id?: string;
  content: Record<string, unknown>;
}) => void;

const subscribeMap = new Map<string, Set<SubscribeCallback>>();

function subscribe(type: string, cb: SubscribeCallback): () => void {
  if (!subscribeMap.has(type)) subscribeMap.set(type, new Set());
  subscribeMap.get(type)!.add(cb);
  return () => subscribeMap.get(type)!.delete(cb);
}

vi.mock("../stores/event-store/index", () => ({
  useEventStore: (selector: (s: { subscribe: typeof subscribe }) => unknown) =>
    selector({ subscribe }),
}));

function fireLoopPaused(content: Record<string, unknown>, projectId = "proj-1") {
  const cbs = subscribeMap.get(EventType.LoopPaused);
  if (!cbs) throw new Error("no subscribers for loop_paused");
  cbs.forEach((cb) =>
    cb({
      type: EventType.LoopPaused,
      project_id: projectId,
      agent_id: (content.agent_instance_id as string) ?? undefined,
      content: { project_id: projectId, ...content },
    }),
  );
}

function fireLoopResumed(projectId = "proj-1") {
  const cbs = subscribeMap.get(EventType.LoopResumed);
  if (!cbs) throw new Error("no subscribers for loop_resumed");
  cbs.forEach((cb) =>
    cb({
      type: EventType.LoopResumed,
      project_id: projectId,
      content: { project_id: projectId },
    }),
  );
}

describe("useCooldownStatus", () => {
  beforeEach(() => {
    subscribeMap.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is idle by default", () => {
    const { result } = renderHook(() => useCooldownStatus(undefined, "proj-1"));
    expect(result.current.paused).toBe(false);
    expect(result.current.remainingSeconds).toBeNull();
    expect(result.current.retryKind).toBeNull();
  });

  it("captures loop_paused payload and decrements remainingSeconds", () => {
    const { result } = renderHook(() => useCooldownStatus(undefined, "proj-1"));

    act(() => {
      fireLoopPaused({
        task_id: "t-1",
        reason: "Rate limited by Anthropic",
        retry_kind: "provider_rate_limited",
        cooldown_ms: 49_000,
      });
    });

    expect(result.current.paused).toBe(true);
    expect(result.current.remainingSeconds).toBe(49);
    expect(result.current.retryKind).toBe("provider_rate_limited");
    expect(result.current.taskId).toBe("t-1");

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.remainingSeconds).toBe(46);
  });

  it("ignores loop_paused from other projects", () => {
    const { result } = renderHook(() => useCooldownStatus(undefined, "proj-1"));

    act(() => {
      fireLoopPaused(
        { retry_kind: "provider_rate_limited", cooldown_ms: 10_000 },
        "proj-999",
      );
    });

    expect(result.current.paused).toBe(false);
  });

  it("clears on loop_resumed", () => {
    const { result } = renderHook(() => useCooldownStatus(undefined, "proj-1"));

    act(() => {
      fireLoopPaused({ retry_kind: "provider_rate_limited", cooldown_ms: 10_000 });
    });
    expect(result.current.paused).toBe(true);

    act(() => {
      fireLoopResumed();
    });
    expect(result.current.paused).toBe(false);
    expect(result.current.remainingSeconds).toBeNull();
  });

  it("handles pause events with no cooldown hint", () => {
    const { result } = renderHook(() => useCooldownStatus(undefined, "proj-1"));

    act(() => {
      fireLoopPaused({ retry_kind: "provider_overloaded" });
    });

    expect(result.current.paused).toBe(true);
    expect(result.current.remainingSeconds).toBeNull();
    expect(result.current.retryKind).toBe("provider_overloaded");
  });
});

describe("cooldownLabel", () => {
  it("maps known retry_kind values to friendly labels", () => {
    expect(cooldownLabel("provider_rate_limited")).toBe("Rate limited by provider");
    expect(cooldownLabel("provider_overloaded")).toBe("Provider overloaded");
    expect(cooldownLabel("transport_timeout")).toBe("Network timeout");
    expect(cooldownLabel("git_timeout")).toBe("Git operation timed out");
  });

  it("falls back to the raw value for unknown kinds", () => {
    expect(cooldownLabel("totally_new_kind")).toBe("totally_new_kind");
  });

  it("returns a generic label for missing kind", () => {
    expect(cooldownLabel(null)).toBe("Paused");
  });
});
