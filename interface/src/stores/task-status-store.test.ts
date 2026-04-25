import { describe, it, expect, beforeEach } from "vitest";
import {
  useTaskStatusStore,
  getTaskLiveStatus,
  EMPTY_TASK_LIVE,
} from "./task-status-store";

beforeEach(() => {
  useTaskStatusStore.getState().reset();
});

describe("useTaskStatusStore", () => {
  it("returns the shared empty singleton for unknown tasks", () => {
    expect(getTaskLiveStatus("missing")).toBe(EMPTY_TASK_LIVE);
  });

  it("setLiveStatus creates and updates per-task entries", () => {
    useTaskStatusStore.getState().setLiveStatus("t1", "in_progress");
    expect(getTaskLiveStatus("t1").liveStatus).toBe("in_progress");

    useTaskStatusStore.getState().setLiveStatus("t1", "done");
    expect(getTaskLiveStatus("t1").liveStatus).toBe("done");
  });

  it("setLiveSessionId is independent of setLiveStatus", () => {
    useTaskStatusStore.getState().setLiveSessionId("t1", "sess-1");
    expect(getTaskLiveStatus("t1").liveSessionId).toBe("sess-1");
    expect(getTaskLiveStatus("t1").liveStatus).toBeNull();
  });

  it("setLiveFailReason stores the reason and can be cleared with null", () => {
    useTaskStatusStore.getState().setLiveFailReason("t1", "boom");
    expect(getTaskLiveStatus("t1").liveFailReason).toBe("boom");

    useTaskStatusStore.getState().setLiveFailReason("t1", null);
    expect(getTaskLiveStatus("t1").liveFailReason).toBeNull();
  });

  it("returns the same `byTaskId` reference on no-op writes", () => {
    useTaskStatusStore.getState().setLiveStatus("t1", "in_progress");
    const before = useTaskStatusStore.getState().byTaskId;

    // Same value -> no state change, identity preserved so subscribers
    // don't re-render.
    useTaskStatusStore.getState().setLiveStatus("t1", "in_progress");
    expect(useTaskStatusStore.getState().byTaskId).toBe(before);
  });

  it("returns a fresh `byTaskId` reference when a field actually changes", () => {
    useTaskStatusStore.getState().setLiveStatus("t1", "in_progress");
    const before = useTaskStatusStore.getState().byTaskId;

    useTaskStatusStore.getState().setLiveStatus("t1", "done");
    expect(useTaskStatusStore.getState().byTaskId).not.toBe(before);
  });

  it("keeps tasks isolated from each other", () => {
    useTaskStatusStore.getState().setLiveStatus("t1", "in_progress");
    useTaskStatusStore.getState().setLiveStatus("t2", "failed");
    useTaskStatusStore.getState().setLiveFailReason("t2", "timeout");

    expect(getTaskLiveStatus("t1").liveStatus).toBe("in_progress");
    expect(getTaskLiveStatus("t1").liveFailReason).toBeNull();
    expect(getTaskLiveStatus("t2").liveStatus).toBe("failed");
    expect(getTaskLiveStatus("t2").liveFailReason).toBe("timeout");
  });

  it("clearTask drops a single entry without disturbing siblings", () => {
    useTaskStatusStore.getState().setLiveStatus("t1", "done");
    useTaskStatusStore.getState().setLiveStatus("t2", "in_progress");

    useTaskStatusStore.getState().clearTask("t1");

    expect(getTaskLiveStatus("t1")).toBe(EMPTY_TASK_LIVE);
    expect(getTaskLiveStatus("t2").liveStatus).toBe("in_progress");
  });

  it("reset wipes all entries", () => {
    useTaskStatusStore.getState().setLiveStatus("t1", "done");
    useTaskStatusStore.getState().setLiveStatus("t2", "failed");

    useTaskStatusStore.getState().reset();

    expect(useTaskStatusStore.getState().byTaskId).toEqual({});
  });
});
