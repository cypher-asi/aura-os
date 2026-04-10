import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "@testing-library/react";
import { useEventStore, getTaskOutput, connectEventSocket } from "./event-store";

const { capture } = vi.hoisted(() => {
  const capture = { onMessage: null as ((data: string) => void) | null };
  return { capture };
});

vi.mock("../hooks/ws-reconnect", () => ({
  createReconnectingWebSocket: (
    _cfg: unknown,
    msgCb: (data: string) => void,
  ) => {
    capture.onMessage = msgCb;
    return { close: () => {} };
  },
}));

vi.mock("../lib/host-config", () => ({
  resolveWsUrl: (path: string) => `ws://localhost${path}`,
}));

vi.mock("../lib/auth-token", () => ({
  getStoredJwt: () => "test-jwt",
}));

function simulateEvent(event: Record<string, unknown>) {
  act(() => {
    capture.onMessage!(JSON.stringify(event));
  });
}

beforeEach(() => {
  useEventStore.setState({ connected: false, lastEventAt: null, taskOutputs: {} });
  connectEventSocket();
});

describe("event-store", () => {
  it("has expected initial state", () => {
    const state = useEventStore.getState();
    expect(state.connected).toBe(false);
    expect(typeof state.subscribe).toBe("function");
    expect(typeof state.seedTaskOutput).toBe("function");
  });

  it("getTaskOutput returns empty output for unknown task", () => {
    const output = getTaskOutput("nonexistent");
    expect(output.text).toBe("");
    expect(output.fileOps).toEqual([]);
    expect(output.buildSteps).toEqual([]);
    expect(output.testSteps).toEqual([]);
  });

  it("seedTaskOutput populates task output", () => {
    useEventStore.getState().seedTaskOutput("task-1", "Build output...");
    const output = getTaskOutput("task-1");
    expect(output.text).toBe("Build output...");
  });

  it("seedTaskOutput does not overwrite existing output", () => {
    useEventStore.getState().seedTaskOutput("task-2", "First");
    useEventStore.getState().seedTaskOutput("task-2", "Second");
    const output = getTaskOutput("task-2");
    expect(output.text).toBe("First");
  });

  it("subscribe returns an unsubscribe function", () => {
    const unsub = useEventStore.getState().subscribe("task_started", vi.fn());
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("task_started clears stale output", () => {
    useEventStore.getState().seedTaskOutput("t2", "old data");
    expect(getTaskOutput("t2").text).toBe("old data");

    simulateEvent({ type: "task_started", task_id: "t2", session_id: "s1" });
    expect(getTaskOutput("t2").text).toBe("");
  });

  it("subscribe notifies on task_started", () => {
    const cb = vi.fn();
    useEventStore.getState().subscribe("task_started", cb);

    simulateEvent({ type: "task_started", task_id: "t3", session_id: "s2" });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ type: "task_started", task_id: "t3" }),
    );
  });

  it("file_ops_applied updates fileOps", () => {
    const files = [{ op: "write", path: "src/main.ts" }];
    simulateEvent({ type: "file_ops_applied", task_id: "t5", files });
    expect(getTaskOutput("t5").fileOps).toEqual(files);
  });

  it("build verification events accumulate buildSteps", () => {
    simulateEvent({ type: "build_verification_started", task_id: "t6" });
    expect(getTaskOutput("t6").buildSteps).toHaveLength(1);
    expect(getTaskOutput("t6").buildSteps[0].kind).toBe("started");

    simulateEvent({ type: "build_verification_passed", task_id: "t6" });
    expect(getTaskOutput("t6").buildSteps).toHaveLength(2);
    expect(getTaskOutput("t6").buildSteps[1].kind).toBe("passed");
  });
});
