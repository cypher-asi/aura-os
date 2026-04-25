import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.hoisted(() => {
  const storage = new Map<string, string>();
  const stub = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
    key: vi.fn((index: number) => Array.from(storage.keys())[index] ?? null),
    get length() {
      return storage.size;
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: stub,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: stub,
    });
  }
});

import type { AuraEvent } from "../types/aura-events";
import { EventType } from "../types/aura-events";
import { subscribers } from "./event-store/event-store";
import { useEventStore } from "./event-store/index";
import { useStreamStore, streamMetaMap } from "../hooks/stream/store";
import {
  bootstrapTaskStreamSubscriptions,
  teardownTaskStreamBootstrap,
  taskStreamKey,
} from "./task-stream-bootstrap";
import { useTaskOutputPanelStore } from "./task-output-panel-store";
import { useTaskStatusStore } from "./task-status-store";

function resetStreamStore(): void {
  useStreamStore.setState({ entries: {} });
  streamMetaMap.clear();
}

function dispatch(event: AuraEvent): void {
  const s = subscribers.get(event.type);
  if (!s) return;
  for (const cb of s) (cb as (e: AuraEvent) => void)(event);
}

function seedActiveTask(taskId: string, projectId = "p1"): void {
  useTaskOutputPanelStore.getState().addTask(taskId, projectId, `Task ${taskId}`);
}

beforeEach(() => {
  subscribers.clear();
  resetStreamStore();
  useEventStore.setState({ taskOutputs: {} });
  useTaskOutputPanelStore.setState({ tasks: [] });
  useTaskStatusStore.getState().reset();
  bootstrapTaskStreamSubscriptions();
});

afterEach(() => {
  teardownTaskStreamBootstrap();
  subscribers.clear();
  resetStreamStore();
  useTaskOutputPanelStore.setState({ tasks: [] });
  useTaskStatusStore.getState().reset();
});

describe("task-stream-bootstrap: handleTaskFailed reason extraction", () => {
  it("stores the canonical `reason` on the panel entry", () => {
    seedActiveTask("t1");
    dispatch({
      type: EventType.TaskFailed,
      content: { task_id: "t1", reason: "gate: missing build step" },
      project_id: "p1",
    } as unknown as AuraEvent);

    const entry = useTaskOutputPanelStore.getState().tasks[0];
    expect(entry.status).toBe("failed");
    expect(entry.failureReason).toBe("gate: missing build step");
  });

  it("falls back to `error` when `reason` is absent", () => {
    seedActiveTask("t1");
    dispatch({
      type: EventType.TaskFailed,
      content: { task_id: "t1", error: "connect timeout" },
      project_id: "p1",
    } as unknown as AuraEvent);

    expect(useTaskOutputPanelStore.getState().tasks[0].failureReason).toBe(
      "connect timeout",
    );
  });

  it("falls back to `message` when both `reason` and `error` are absent", () => {
    seedActiveTask("t1");
    dispatch({
      type: EventType.TaskFailed,
      content: { task_id: "t1", message: "legacy message" },
      project_id: "p1",
    } as unknown as AuraEvent);

    expect(useTaskOutputPanelStore.getState().tasks[0].failureReason).toBe(
      "legacy message",
    );
  });

  it("leaves failureReason undefined when the event carries no reason field", () => {
    seedActiveTask("t1");
    dispatch({
      type: EventType.TaskFailed,
      content: { task_id: "t1" },
      project_id: "p1",
    } as unknown as AuraEvent);

    const entry = useTaskOutputPanelStore.getState().tasks[0];
    expect(entry.status).toBe("failed");
    expect(entry.failureReason).toBeUndefined();
  });
});

describe("task-stream-bootstrap: task_retrying resolves pending tool cards", () => {
  it("flips in-flight tool_use_start cards to error when the task retries", () => {
    seedActiveTask("t1");

    dispatch({
      type: EventType.TaskStarted,
      content: { task_id: "t1", task_title: "Task t1" },
      project_id: "p1",
    } as unknown as AuraEvent);

    // Tool call arrives mid-turn but never gets a matching tool_result
    // because the harness's LLM stream dies with a transient 5xx.
    dispatch({
      type: EventType.ToolUseStart,
      content: { task_id: "t1", id: "call-1", name: "write_file" },
      project_id: "p1",
    } as unknown as AuraEvent);

    const keyBefore = taskStreamKey("t1");
    const beforeEntry = useStreamStore.getState().entries[keyBefore];
    expect(beforeEntry).toBeDefined();
    const pendingBefore = beforeEntry!.activeToolCalls.find(
      (c) => c.id === "call-1",
    );
    expect(pendingBefore?.pending).toBe(true);

    // Dev loop classifies the failure as transient and emits
    // task_retrying before restarting the automaton.
    dispatch({
      type: EventType.TaskRetrying,
      content: {
        task_id: "t1",
        attempt: 2,
        reason: "provider_internal_error: stream terminated with error: Internal server error",
      },
      project_id: "p1",
    } as unknown as AuraEvent);

    const afterEntry = useStreamStore.getState().entries[taskStreamKey("t1")];
    const resolved = afterEntry!.activeToolCalls.find((c) => c.id === "call-1");
    expect(resolved).toBeDefined();
    expect(resolved!.pending).toBe(false);
    expect(resolved!.isError).toBe(true);
    expect(resolved!.result).toContain("Interrupted by upstream error");
    expect(resolved!.result).toContain("Internal server error");
  });

  it("works without a reason, using a generic interruption label", () => {
    seedActiveTask("t1");
    dispatch({
      type: EventType.TaskStarted,
      content: { task_id: "t1", task_title: "Task t1" },
      project_id: "p1",
    } as unknown as AuraEvent);
    dispatch({
      type: EventType.ToolUseStart,
      content: { task_id: "t1", id: "call-2", name: "edit_file" },
      project_id: "p1",
    } as unknown as AuraEvent);
    dispatch({
      type: EventType.TaskRetrying,
      content: { task_id: "t1", attempt: 2 },
      project_id: "p1",
    } as unknown as AuraEvent);

    const entry = useStreamStore.getState().entries[taskStreamKey("t1")];
    const resolved = entry!.activeToolCalls.find((c) => c.id === "call-2");
    expect(resolved!.isError).toBe(true);
    expect(resolved!.result).toContain("retrying after upstream error");
  });

  it("leaves already-resolved tool cards untouched on retry", () => {
    seedActiveTask("t1");
    dispatch({
      type: EventType.TaskStarted,
      content: { task_id: "t1", task_title: "Task t1" },
      project_id: "p1",
    } as unknown as AuraEvent);
    dispatch({
      type: EventType.ToolUseStart,
      content: { task_id: "t1", id: "call-ok", name: "read_file" },
      project_id: "p1",
    } as unknown as AuraEvent);
    dispatch({
      type: EventType.ToolResult,
      content: {
        task_id: "t1",
        id: "call-ok",
        name: "read_file",
        result: "ok",
        is_error: false,
      },
      project_id: "p1",
    } as unknown as AuraEvent);
    dispatch({
      type: EventType.TaskRetrying,
      content: { task_id: "t1", attempt: 2, reason: "rate limited" },
      project_id: "p1",
    } as unknown as AuraEvent);

    const entry = useStreamStore.getState().entries[taskStreamKey("t1")];
    const ok = entry!.activeToolCalls.find((c) => c.id === "call-ok");
    expect(ok!.isError).toBeFalsy();
    expect(ok!.result).toBe("ok");
  });
});

describe("task-stream-bootstrap: task_completion_gate", () => {
  it("appends an error tool card when the gate rejects a completion", () => {
    seedActiveTask("t1");

    dispatch({
      type: EventType.TaskCompletionGate,
      content: {
        task_id: "t1",
        passed: false,
        failure_reason:
          "Task modified source code but no build/compile step was run",
        had_live_output: true,
        n_files_changed: 2,
        has_source_change: true,
        has_rust_change: true,
        n_build_steps: 0,
        n_test_steps: 0,
        n_format_steps: 0,
        n_lint_steps: 0,
        n_empty_path_writes: 0,
        recovery_checkpoint: "initial",
      },
      project_id: "p1",
    } as unknown as AuraEvent);

    const entry = useStreamStore.getState().entries[taskStreamKey("t1")];
    expect(entry).toBeDefined();
    const errorCard = entry!.activeToolCalls.find(
      (c) => c.name === "completion_gate_rejected",
    );
    expect(errorCard).toBeDefined();
    expect(errorCard!.isError).toBe(true);
    expect(errorCard!.result).toContain(
      "Task modified source code but no build/compile step was run",
    );
    expect(errorCard!.result).toContain("build 0");
    expect(errorCard!.result).toContain("test 0");
    expect(errorCard!.result).toContain("rust");
  });

  it("does nothing when the gate passed", () => {
    seedActiveTask("t1");

    dispatch({
      type: EventType.TaskCompletionGate,
      content: {
        task_id: "t1",
        passed: true,
        had_live_output: true,
        n_files_changed: 2,
        has_source_change: true,
        has_rust_change: true,
        n_build_steps: 1,
        n_test_steps: 1,
        n_format_steps: 1,
        n_lint_steps: 1,
        n_empty_path_writes: 0,
        recovery_checkpoint: "initial",
      },
      project_id: "p1",
    } as unknown as AuraEvent);

    const entry = useStreamStore.getState().entries[taskStreamKey("t1")];
    // Either no entry was created, or no completion_gate_rejected card
    // was appended if some other path touched the stream.
    if (entry) {
      const errorCard = entry.activeToolCalls.find(
        (c) => c.name === "completion_gate_rejected",
      );
      expect(errorCard).toBeUndefined();
    }
  });
});

describe("task-stream-bootstrap: per-task status store wiring", () => {
  it("flips the status store to in_progress and captures session_id on TaskStarted", () => {
    dispatch({
      type: EventType.TaskStarted,
      content: { task_id: "t1", task_title: "Task t1" },
      project_id: "p1",
      session_id: "sess-1",
    } as unknown as AuraEvent);

    const live = useTaskStatusStore.getState().byTaskId["t1"];
    expect(live).toBeDefined();
    expect(live!.liveStatus).toBe("in_progress");
    expect(live!.liveSessionId).toBe("sess-1");
  });

  it("clears a stale liveFailReason when a task starts again (retry path)", () => {
    useTaskStatusStore.getState().setLiveFailReason("t1", "previous attempt died");

    dispatch({
      type: EventType.TaskStarted,
      content: { task_id: "t1", task_title: "Task t1" },
      project_id: "p1",
      session_id: "sess-2",
    } as unknown as AuraEvent);

    expect(useTaskStatusStore.getState().byTaskId["t1"]?.liveFailReason).toBeNull();
  });

  it("transitions status to done on TaskCompleted", () => {
    dispatch({
      type: EventType.TaskStarted,
      content: { task_id: "t1", task_title: "Task t1" },
      project_id: "p1",
    } as unknown as AuraEvent);

    dispatch({
      type: EventType.TaskCompleted,
      content: { task_id: "t1" },
      project_id: "p1",
    } as unknown as AuraEvent);

    expect(useTaskStatusStore.getState().byTaskId["t1"]?.liveStatus).toBe("done");
  });

  it("transitions status to failed and records the canonical reason", () => {
    dispatch({
      type: EventType.TaskFailed,
      content: { task_id: "t1", reason: "gate: missing build step" },
      project_id: "p1",
    } as unknown as AuraEvent);

    const live = useTaskStatusStore.getState().byTaskId["t1"];
    expect(live!.liveStatus).toBe("failed");
    expect(live!.liveFailReason).toBe("gate: missing build step");
  });

  it("falls back through error/message when reason is absent on TaskFailed", () => {
    dispatch({
      type: EventType.TaskFailed,
      content: { task_id: "t1", error: "connect timeout" },
      project_id: "p1",
    } as unknown as AuraEvent);

    expect(useTaskStatusStore.getState().byTaskId["t1"]?.liveFailReason).toBe(
      "connect timeout",
    );
  });

  it("preserves an earlier liveFailReason when TaskFailed carries no reason", () => {
    useTaskStatusStore.getState().setLiveFailReason("t1", "earlier real reason");

    dispatch({
      type: EventType.TaskFailed,
      content: { task_id: "t1" },
      project_id: "p1",
    } as unknown as AuraEvent);

    const live = useTaskStatusStore.getState().byTaskId["t1"];
    expect(live!.liveStatus).toBe("failed");
    expect(live!.liveFailReason).toBe("earlier real reason");
  });
});
