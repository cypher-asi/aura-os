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

// Hoisted spy lets a single test simulate `handleToolCallStarted`
// throwing (the reducer chain `emitSyntheticTransitionBlock` drives),
// while every other test continues to exercise the real
// implementation via the factory-installed default below.
const { toolCallStartedSpy } = vi.hoisted(() => ({
  toolCallStartedSpy: vi.fn(),
}));

vi.mock("../hooks/stream/handlers", async () => {
  const actual = await vi.importActual<
    typeof import("../hooks/stream/handlers")
  >("../hooks/stream/handlers");
  // Default: pass through to the real implementation so the rest of
  // the file's assertions (which depend on the synthetic transition
  // block landing in the stream store) keep working unchanged.
  toolCallStartedSpy.mockImplementation(actual.handleToolCallStarted);
  return {
    ...actual,
    handleToolCallStarted: (
      ...args: Parameters<typeof actual.handleToolCallStarted>
    ) => toolCallStartedSpy(...args),
  };
});

import type { AuraEvent } from "../shared/types/aura-events";
import { EventType } from "../shared/types/aura-events";
import { subscribers } from "./event-store/event-store";
import { useEventStore } from "./event-store/index";
import { useStreamStore, streamMetaMap, ensureEntry } from "../hooks/stream/store";
import {
  bootstrapTaskStreamSubscriptions,
  teardownTaskStreamBootstrap,
  taskStreamKey,
} from "./task-stream-bootstrap";
import { useTaskOutputPanelStore } from "./task-output-panel-store";
import { useAutomationLoopStore } from "./automation-loop-store";
import { useTaskStatusStore } from "./task-status-store";
import { useContextUsageStore } from "./context-usage-store";
import { flushPendingTokenBumps } from "./context-usage-throttle";

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
  useAutomationLoopStore.getState().reset();
  useTaskStatusStore.getState().reset();
  useContextUsageStore.setState({
    usageByStreamKey: {},
    utilPerTokenByStreamKey: {},
    resetPendingByStreamKey: {},
  });
  bootstrapTaskStreamSubscriptions();
});

afterEach(() => {
  teardownTaskStreamBootstrap();
  subscribers.clear();
  resetStreamStore();
  useTaskOutputPanelStore.setState({ tasks: [] });
  useTaskStatusStore.getState().reset();
  useContextUsageStore.setState({
    usageByStreamKey: {},
    utilPerTokenByStreamKey: {},
    resetPendingByStreamKey: {},
  });
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

  it("captures the structured provider failure context from sibling fields", () => {
    seedActiveTask("t1");
    dispatch({
      type: EventType.TaskFailed,
      content: {
        task_id: "t1",
        reason: "stream terminated",
        provider_request_id: "req_01ABC",
        model: "claude-sonnet-4",
        sse_error_type: "api_error",
        message_id: "msg_01",
      },
      project_id: "p1",
    } as unknown as AuraEvent);

    const entry = useTaskOutputPanelStore.getState().tasks[0];
    expect(entry.failureContext?.providerRequestId).toBe("req_01ABC");
    expect(entry.failureContext?.model).toBe("claude-sonnet-4");
    expect(entry.failureContext?.sseErrorType).toBe("api_error");
    expect(entry.failureContext?.messageId).toBe("msg_01");
  });

  it("accepts legacy request_id / error_type / msg_id aliases on the event", () => {
    // Pre-Commit-D servers (and any downstream that didn't migrate to
    // the new names yet) emit `request_id` / `error_type` / `msg_id`
    // as siblings. Keep them round-tripping so a newer UI still shows
    // the label when talking to an older server.
    seedActiveTask("t1");
    dispatch({
      type: EventType.TaskFailed,
      content: {
        task_id: "t1",
        reason: "stream terminated",
        request_id: "req_legacy",
        error_type: "overloaded_error",
        msg_id: "msg_legacy",
      },
      project_id: "p1",
    } as unknown as AuraEvent);

    const entry = useTaskOutputPanelStore.getState().tasks[0];
    expect(entry.failureContext?.providerRequestId).toBe("req_legacy");
    expect(entry.failureContext?.sseErrorType).toBe("overloaded_error");
    expect(entry.failureContext?.messageId).toBe("msg_legacy");
  });

  it("leaves failureContext undefined when no structured fields are present", () => {
    seedActiveTask("t1");
    dispatch({
      type: EventType.TaskFailed,
      content: { task_id: "t1", reason: "plain reason" },
      project_id: "p1",
    } as unknown as AuraEvent);

    expect(
      useTaskOutputPanelStore.getState().tasks[0].failureContext,
    ).toBeUndefined();
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

describe("task-stream-bootstrap: live subagent council events", () => {
  it("folds council members into the active task stream immediately", () => {
    dispatch({
      type: EventType.TaskStarted,
      content: { task_id: "t-council", task_title: "Council task" },
      project_id: "p1",
    } as unknown as AuraEvent);

    dispatch({
      type: EventType.SubagentSpawned,
      content: {
        task_id: "t-council",
        child_run_id: "child-b",
        parent_tool_use_id: "toolu_council_1",
        subagent_type: "council-member",
        prompt: "compare options",
        model: "anthropic/claude",
        council_index: 1,
      },
      project_id: "p1",
    } as unknown as AuraEvent);
    dispatch({
      type: EventType.SubagentSpawned,
      content: {
        task_id: "t-council",
        child_run_id: "child-a",
        parent_tool_use_id: "toolu_council_1",
        subagent_type: "council-member",
        prompt: "compare options",
        model: "openai/gpt",
        council_index: 0,
      },
      project_id: "p1",
    } as unknown as AuraEvent);
    dispatch({
      type: EventType.SubagentStatus,
      content: {
        task_id: "t-council",
        child_run_id: "child-b",
        state: "completed",
      },
      project_id: "p1",
    } as unknown as AuraEvent);

    const entry = useStreamStore.getState().entries[taskStreamKey("t-council")];
    const council = entry.activeToolCalls.find((tc) => tc.id === "toolu_council_1");
    expect(council).toBeDefined();
    expect(council?.councilMembers?.map((m) => m.childRunId)).toEqual([
      "child-a",
      "child-b",
    ]);
    expect(council?.councilMembers?.[1].status).toBe("completed");
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

  it("propagates session_id and agent_id onto the Run panel entry on TaskStarted", () => {
    // The panel entry's `sessionId` / `agentInstanceId` are what
    // `useTaskOutputView` uses to fall back to `api.listSessionEvents`
    // when the local `task-turn-cache` is empty (background loop /
    // cold reload). Without this propagation the rehydrate path
    // could not find the right session to replay.
    dispatch({
      type: EventType.TaskStarted,
      content: { task_id: "t-route", task_title: "Routes" },
      project_id: "p1",
      agent_id: "agent-loop-1",
      session_id: "sess-route",
    } as unknown as AuraEvent);

    const entry = useTaskOutputPanelStore
      .getState()
      .tasks.find((t) => t.taskId === "t-route");
    expect(entry).toBeDefined();
    expect(entry!.sessionId).toBe("sess-route");
    expect(entry!.agentInstanceId).toBe("agent-loop-1");
  });

  it("refreshes the panel entry's sessionId when a re-run starts a new session", () => {
    // A `done -> ready -> in_progress` retry produces a brand new
    // session, so a stale `sessionId` on the panel entry would point
    // at history the user already replayed. The store must replace
    // it rather than silently keep the old value.
    useTaskOutputPanelStore
      .getState()
      .addTask("t-retry", "p1", "Retry task", "agent-1", "sess-old");

    dispatch({
      type: EventType.TaskStarted,
      content: { task_id: "t-retry", task_title: "Retry task" },
      project_id: "p1",
      agent_id: "agent-1",
      session_id: "sess-new",
    } as unknown as AuraEvent);

    const entry = useTaskOutputPanelStore
      .getState()
      .tasks.find((t) => t.taskId === "t-retry");
    expect(entry!.sessionId).toBe("sess-new");
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

describe("task-stream-bootstrap: context-usage wiring", () => {
  it("stores per-task context utilization on AssistantMessageEnd", () => {
    seedActiveTask("t1");
    dispatch({
      type: EventType.AssistantMessageEnd,
      content: {
        task_id: "t1",
        message_id: "msg_1",
        stop_reason: "end_turn",
        usage: {
          context_utilization: 0.42,
          estimated_context_tokens: 8400,
          context_breakdown: {
            system_prompt_tokens: 1200,
            tools_tokens: 600,
            skills_tokens: 100,
            mcp_tokens: 0,
            subagents_tokens: 0,
            conversation_tokens: 6500,
          },
        },
      },
      project_id: "p1",
    } as unknown as AuraEvent);

    const entry = useContextUsageStore.getState().usageByStreamKey[taskStreamKey("t1")];
    expect(entry).toBeDefined();
    expect(entry!.utilization).toBeCloseTo(0.42);
    expect(entry!.estimatedTokens).toBe(8400);
    expect(entry!.breakdown).toBeDefined();
    expect(entry!.breakdown!.systemPromptTokens).toBe(1200);
    expect(entry!.breakdown!.conversationTokens).toBe(6500);
  });

  it("ignores AssistantMessageEnd payloads without usage", () => {
    seedActiveTask("t1");
    dispatch({
      type: EventType.AssistantMessageEnd,
      content: {
        task_id: "t1",
        message_id: "msg_1",
        stop_reason: "end_turn",
      },
      project_id: "p1",
    } as unknown as AuraEvent);

    expect(
      useContextUsageStore.getState().usageByStreamKey[taskStreamKey("t1")],
    ).toBeUndefined();
  });

  it("optimistically bumps estimated tokens on TextDelta when a ratio is cached", () => {
    seedActiveTask("t1");
    // Seed an authoritative reading so a util-per-token ratio is cached.
    dispatch({
      type: EventType.AssistantMessageEnd,
      content: {
        task_id: "t1",
        message_id: "msg_1",
        stop_reason: "end_turn",
        usage: {
          context_utilization: 0.5,
          estimated_context_tokens: 10000,
        },
      },
      project_id: "p1",
    } as unknown as AuraEvent);

    const baseline = useContextUsageStore.getState().usageByStreamKey[taskStreamKey("t1")];
    expect(baseline!.estimatedTokens).toBe(10000);

    dispatch({
      type: EventType.TextDelta,
      content: { task_id: "t1", text: "x".repeat(400) },
      project_id: "p1",
    } as unknown as AuraEvent);
    // Delta bumps are coalesced (see `context-usage-throttle.ts`);
    // drain them so the assertion sees the bumped value immediately.
    flushPendingTokenBumps();

    const bumped = useContextUsageStore.getState().usageByStreamKey[taskStreamKey("t1")];
    expect(bumped!.estimatedTokens).toBeGreaterThan(baseline!.estimatedTokens!);
    expect(bumped!.utilization).toBeGreaterThan(baseline!.utilization);
  });

  it("clears stale context-usage on TaskStarted so a rerun doesn't flash the previous turn's value", () => {
    seedActiveTask("t1");
    useContextUsageStore.getState().setContextUtilization(taskStreamKey("t1"), 0.77, 12000);
    expect(
      useContextUsageStore.getState().usageByStreamKey[taskStreamKey("t1")],
    ).toBeDefined();

    dispatch({
      type: EventType.TaskStarted,
      content: { task_id: "t1", task_title: "Task t1" },
      project_id: "p1",
    } as unknown as AuraEvent);

    expect(
      useContextUsageStore.getState().usageByStreamKey[taskStreamKey("t1")],
    ).toBeUndefined();
  });
});

describe("task-stream-bootstrap: synthetic transition_task lifecycle blocks", () => {
  // Picks the synthetic transition_task entry created by the
  // lifecycle handler. activeToolCalls is the live list (entries get
  // moved to events on finalizeStream); both surfaces should be
  // checked depending on whether the task is mid-run or completed.
  function findTransitionEntry(
    list: Array<{ name: string; input: Record<string, unknown> }>,
    toStatus: string,
  ) {
    return list.find(
      (c) =>
        c.name === "transition_task" &&
        (c.input as { status?: string }).status === toStatus,
    );
  }

  it("appends a `ready -> in_progress` block on TaskStarted", () => {
    dispatch({
      type: EventType.TaskStarted,
      content: { task_id: "t1", task_title: "Task t1" },
      project_id: "p1",
    } as unknown as AuraEvent);

    const entry = useStreamStore.getState().entries[taskStreamKey("t1")];
    expect(entry).toBeDefined();
    const block = findTransitionEntry(entry!.activeToolCalls, "in_progress");
    expect(block).toBeDefined();
    expect(block!.input.from_status).toBe("ready");
    expect(block!.input.task_id).toBe("t1");
  });

  it("appends a closing `in_progress -> done` block on TaskCompleted that survives finalize", () => {
    seedActiveTask("t1");
    dispatch({
      type: EventType.TaskStarted,
      content: { task_id: "t1", task_title: "Task t1" },
      project_id: "p1",
    } as unknown as AuraEvent);

    dispatch({
      type: EventType.TaskCompleted,
      content: { task_id: "t1", task_title: "Task t1" },
      project_id: "p1",
    } as unknown as AuraEvent);

    // After finalizeStream the closing block must live in `events[]`
    // (the snapshotted assistant turn). Without injecting BEFORE
    // finalize, the block would be discarded.
    const entry = useStreamStore.getState().entries[taskStreamKey("t1")];
    expect(entry).toBeDefined();
    const allToolCalls = entry!.events.flatMap((e) => e.toolCalls ?? []);
    const closing = findTransitionEntry(
      allToolCalls as unknown as Array<{ name: string; input: Record<string, unknown> }>,
      "done",
    );
    expect(closing).toBeDefined();
    expect(closing!.input.from_status).toBe("in_progress");
  });

  it("appends a closing `in_progress -> failed` block carrying the reason on TaskFailed", () => {
    seedActiveTask("t1");
    dispatch({
      type: EventType.TaskStarted,
      content: { task_id: "t1", task_title: "Task t1" },
      project_id: "p1",
    } as unknown as AuraEvent);

    dispatch({
      type: EventType.TaskFailed,
      content: { task_id: "t1", reason: "build broke" },
      project_id: "p1",
    } as unknown as AuraEvent);

    const entry = useStreamStore.getState().entries[taskStreamKey("t1")];
    expect(entry).toBeDefined();
    const allToolCalls = entry!.events.flatMap((e) => e.toolCalls ?? []);
    const closing = (allToolCalls as unknown as Array<{
      name: string;
      input: Record<string, unknown>;
      isError?: boolean;
      result?: string;
    }>).find(
      (c) =>
        c.name === "transition_task" &&
        (c.input as { status?: string }).status === "failed",
    );
    expect(closing).toBeDefined();
    expect(closing!.input.from_status).toBe("in_progress");
    expect(closing!.isError).toBe(true);
    expect(closing!.result).toContain("build broke");
  });
});

describe("task-stream-bootstrap: synthetic emit failures stay isolated", () => {
  // Regression: the synthetic `transition_task` block emits in
  // `handleTaskStarted` / `handleTaskCompleted` / `handleTaskFailed`
  // are decorative — they MUST NOT be able to interrupt the core
  // lifecycle work (`addTask`, `setLiveStatus`, `completeTask`,
  // `failTask`, `snapshotTaskTurns`). This test mocks
  // `handleToolCallStarted` to throw once, simulating a reducer
  // failure inside the synthetic emit, and asserts that the Run
  // panel row still appears for the started task.

  it("populates the task row on TaskStarted even if the synthetic emit throws", () => {
    // Suppress the DEV-only console.warn the try/catch emits so the
    // test output stays clean. The wrap is the contract under test.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // First handleToolCallStarted call (the synthetic block) throws;
    // subsequent calls fall through to the factory default.
    toolCallStartedSpy.mockImplementationOnce(() => {
      throw new Error("simulated reducer failure");
    });

    dispatch({
      type: EventType.TaskStarted,
      content: { task_id: "t1", task_title: "Task t1" },
      project_id: "p1",
      session_id: "sess-1",
    } as unknown as AuraEvent);

    const panelTasks = useTaskOutputPanelStore.getState().tasks;
    expect(panelTasks).toHaveLength(1);
    expect(panelTasks[0].taskId).toBe("t1");
    expect(panelTasks[0].status).toBe("active");
    // The status / session updates that live BEFORE the synthetic
    // emit must have run; the wrap is what guarantees they stay
    // reachable even if the synthetic reducer chain blows up.
    const live = useTaskStatusStore.getState().byTaskId["t1"];
    expect(live?.liveStatus).toBe("in_progress");
    expect(live?.liveSessionId).toBe("sess-1");

    warnSpy.mockRestore();
  });

  it("completes the task on TaskCompleted even if the synthetic emit throws", () => {
    // `handleTaskCompleted` calls the synthetic emit BEFORE
    // `finalizeStream` / `completeTask` / `setLiveStatus("done")` /
    // `snapshotTaskTurns`, so this scenario is where the wrap
    // genuinely earns its keep — without the try/catch a throw here
    // would leave the task stuck on "active" forever.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    dispatch({
      type: EventType.TaskStarted,
      content: { task_id: "t2", task_title: "Task t2" },
      project_id: "p1",
    } as unknown as AuraEvent);

    // Clear the call queue from TaskStarted's synthetic emit so the
    // next `mockImplementationOnce` targets the TaskCompleted call.
    toolCallStartedSpy.mockClear();
    toolCallStartedSpy.mockImplementationOnce(() => {
      throw new Error("simulated reducer failure on completion");
    });

    dispatch({
      type: EventType.TaskCompleted,
      content: { task_id: "t2", task_title: "Task t2" },
      project_id: "p1",
    } as unknown as AuraEvent);

    const row = useTaskOutputPanelStore
      .getState()
      .tasks.find((t) => t.taskId === "t2");
    expect(row).toBeDefined();
    expect(row!.status).toBe("completed");
    expect(useTaskStatusStore.getState().byTaskId["t2"]?.liveStatus).toBe(
      "done",
    );

    warnSpy.mockRestore();
  });
});

describe("task-stream-bootstrap: synthetic flag is threaded onto ToolCallEntry", () => {
  // Plumbing test for the `synthetic: true` flag added to ToolCallEntry
  // (see interface/src/shared/types/stream.ts). The flag is what lets
  // `getStreamingPhaseLabel` and `ActiveTaskStream`'s `hasContent`
  // gate filter decorative lifecycle cards out of phase-label /
  // has-content checks. Without the round-trip working, the
  // downstream filters in commits 2 and 3 silently no-op.

  it("tags the synthetic transition_task entry with synthetic: true", () => {
    dispatch({
      type: EventType.TaskStarted,
      content: { task_id: "t1", task_title: "Task t1" },
      project_id: "p1",
    } as unknown as AuraEvent);

    const entry = useStreamStore.getState().entries[taskStreamKey("t1")];
    expect(entry).toBeDefined();
    const transition = entry!.activeToolCalls.find(
      (c) => c.name === "transition_task",
    );
    expect(transition).toBeDefined();
    expect(transition!.synthetic).toBe(true);
  });

  it("does NOT tag a real (harness-emitted) tool call as synthetic", () => {
    seedActiveTask("t1");
    dispatch({
      type: EventType.TaskStarted,
      content: { task_id: "t1", task_title: "Task t1" },
      project_id: "p1",
    } as unknown as AuraEvent);

    // Real tool_use_start arrives over the wire after the synthetic
    // transition card. The harness payload carries no `synthetic`
    // flag, so the entry's `synthetic` must remain falsy — that's
    // what keeps real tools driving the cooking-shimmer phase label.
    dispatch({
      type: EventType.ToolUseStart,
      content: { task_id: "t1", id: "real-1", name: "write_file" },
      project_id: "p1",
    } as unknown as AuraEvent);

    const entry = useStreamStore.getState().entries[taskStreamKey("t1")];
    const real = entry!.activeToolCalls.find((c) => c.id === "real-1");
    expect(real).toBeDefined();
    expect(real!.name).toBe("write_file");
    expect(real!.synthetic).toBeFalsy();
  });
});

describe("task-stream-bootstrap: task_updated synthetic blocks", () => {
  it("renders a single `update_task` block summarising the changed fields", () => {
    seedActiveTask("t1");
    dispatch({
      type: EventType.TaskUpdated,
      content: { task_id: "t1", changed_fields: ["title", "description"] },
      project_id: "p1",
    } as unknown as AuraEvent);

    const entry = useStreamStore.getState().entries[taskStreamKey("t1")];
    expect(entry).toBeDefined();
    const block = entry!.activeToolCalls.find((c) => c.name === "update_task");
    expect(block).toBeDefined();
    expect(block!.input.changed_fields).toEqual(["title", "description"]);
    expect(block!.result).toBe("title, description");
    expect(block!.isError).toBeFalsy();
  });

  it("ignores task_updated with no changed_fields (defensive: no-op writes)", () => {
    seedActiveTask("t1");
    dispatch({
      type: EventType.TaskUpdated,
      content: { task_id: "t1", changed_fields: [] },
      project_id: "p1",
    } as unknown as AuraEvent);

    const entry = useStreamStore.getState().entries[taskStreamKey("t1")];
    if (entry) {
      expect(
        entry.activeToolCalls.find((c) => c.name === "update_task"),
      ).toBeUndefined();
    }
  });

  it("dedupes against lifecycle: a status-edge task_updated does NOT add a second transition block", () => {
    seedActiveTask("t1");
    dispatch({
      type: EventType.TaskStarted,
      content: { task_id: "t1", task_title: "Task t1" },
      project_id: "p1",
    } as unknown as AuraEvent);
    // The TaskStarted handler synthesised one transition_task block.
    // A bystander task_updated that piggybacks on the same status
    // edge (e.g. server's update_task with status=in_progress) must
    // not stack a second card.
    dispatch({
      type: EventType.TaskUpdated,
      content: {
        task_id: "t1",
        changed_fields: ["status"],
        status: { from: "ready", to: "in_progress" },
      },
      project_id: "p1",
    } as unknown as AuraEvent);

    const entry = useStreamStore.getState().entries[taskStreamKey("t1")];
    const transitions = entry!.activeToolCalls.filter(
      (c) => c.name === "transition_task",
    );
    expect(transitions).toHaveLength(1);
  });

  it("mirrors a status-edge task_updated into the live-status store", () => {
    // Tool-driven completions (agent calling `transition_task`) arrive
    // as a `task_updated` { from, to } broadcast with no harness
    // `task_completed` lifecycle event. The handler must still flip
    // `liveStatus` so the task modal/preview switches off "Cooking..."
    // without a manual refresh.
    seedActiveTask("t1");
    dispatch({
      type: EventType.TaskUpdated,
      content: {
        task_id: "t1",
        changed_fields: ["status"],
        status: { from: "in_progress", to: "done" },
      },
      project_id: "p1",
    } as unknown as AuraEvent);

    expect(useTaskStatusStore.getState().byTaskId["t1"]?.liveStatus).toBe(
      "done",
    );
  });

  it("finalizes the live task stream on a terminal status edge even with no Run pane row", () => {
    // Single-task runs AND the dev loop complete a task via the
    // agent's `transition_task` tool, which emits only a `task_updated`
    // status edge (never a harness `task_completed`). A task that was
    // previewed but never pinned to the Run pane has its live stream
    // `isStreaming` flag set (the "Cooking…" / Live Output block) but no
    // panel row, so the handler must finalize the stream unconditionally
    // — not only when a Run pane row exists.
    const key = taskStreamKey("t-nopane");
    ensureEntry(key);
    useStreamStore.setState((s) => ({
      entries: { ...s.entries, [key]: { ...s.entries[key]!, isStreaming: true } },
    }));
    // No seedActiveTask → deliberately no Run pane row for this task.
    expect(
      useTaskOutputPanelStore.getState().tasks.some((t) => t.taskId === "t-nopane"),
    ).toBe(false);

    dispatch({
      type: EventType.TaskUpdated,
      content: {
        task_id: "t-nopane",
        changed_fields: ["status"],
        status: { from: "in_progress", to: "done" },
      },
      project_id: "p1",
    } as unknown as AuraEvent);

    expect(useStreamStore.getState().entries[key]?.isStreaming).toBe(false);
    expect(useTaskStatusStore.getState().byTaskId["t-nopane"]?.liveStatus).toBe(
      "done",
    );
    // completeTask is a no-op for an unknown Run-pane id: still no row.
    expect(
      useTaskOutputPanelStore.getState().tasks.some((t) => t.taskId === "t-nopane"),
    ).toBe(false);
  });
});

describe("task-stream-bootstrap: Run pane binding", () => {
  it("adds a Run pane row when project_id is only present in content", () => {
    dispatch({
      type: EventType.TaskStarted,
      content: { task_id: "t1", task_title: "Task t1", project_id: "p1" },
      project_id: "",
    } as unknown as AuraEvent);

    const row = useTaskOutputPanelStore.getState().tasks.find((t) => t.taskId === "t1");
    expect(row).toBeDefined();
    expect(row!.projectId).toBe("p1");
    expect(row!.status).toBe("active");
  });

  it("hydrates an active row from loop_activity_changed when current_task_id is set", () => {
    dispatch({
      type: EventType.LoopActivityChanged,
      content: {
        loop_id: {
          instance: "loop-inst-1",
          project_id: "p1",
          agent_instance_id: "agent-loop",
          agent_id: "agent-tmpl",
          kind: "automation",
        },
        activity: {
          status: "running",
          started_at: new Date().toISOString(),
          last_event_at: new Date().toISOString(),
          current_task_id: "t-loop",
          current_step: "thinking",
        },
      },
      project_id: "p1",
      project_agent_id: "agent-loop",
    } as unknown as AuraEvent);

    const row = useTaskOutputPanelStore.getState().tasks.find((t) => t.taskId === "t-loop");
    expect(row).toBeDefined();
    expect(row!.projectId).toBe("p1");
    expect(row!.status).toBe("active");
  });

  it("renders tool_call_started into the per-task stream store", () => {
    dispatch({
      type: EventType.ToolCallStarted,
      content: {
        task_id: "t1",
        id: "call-1",
        name: "read_file",
      },
      project_id: "p1",
    } as unknown as AuraEvent);

    const row = useTaskOutputPanelStore.getState().tasks.find((t) => t.taskId === "t1");
    expect(row).toBeDefined();
    const entry = useStreamStore.getState().entries[taskStreamKey("t1")];
    expect(entry?.activeToolCalls.some((c) => c.name === "read_file")).toBe(true);
  });

  it("renders tool_call_completed into the per-task stream store", () => {
    seedActiveTask("t1");
    dispatch({
      type: EventType.ToolCallStarted,
      content: { task_id: "t1", id: "call-1", name: "read_file" },
      project_id: "p1",
    } as unknown as AuraEvent);
    dispatch({
      type: EventType.ToolCallCompleted,
      content: {
        task_id: "t1",
        id: "call-1",
        name: "read_file",
        result: "file contents",
        is_error: false,
      },
      project_id: "p1",
    } as unknown as AuraEvent);

    const entry = useStreamStore.getState().entries[taskStreamKey("t1")];
    const tool = entry?.activeToolCalls.find((c) => c.id === "call-1");
    expect(tool?.result).toBe("file contents");
  });
});

describe("loop terminal events", () => {
  it("ignores loop_finished from ephemeral task-runner agents", () => {
    useAutomationLoopStore.getState().setLoopAgent("p1", "bound-loop");
    useTaskOutputPanelStore.getState().addTask("live-task", "p1", "Live", "bound-loop");

    dispatch({
      type: EventType.LoopFinished,
      project_id: "p1",
      agent_id: "ephemeral-runner",
      content: {},
    } as unknown as AuraEvent);

    const row = useTaskOutputPanelStore.getState().tasks.find((t) => t.taskId === "live-task");
    expect(row?.status).toBe("active");
  });

  it("completes rows when loop_finished arrives for the bound loop agent", () => {
    useAutomationLoopStore.getState().setLoopAgent("p1", "bound-loop");
    useTaskOutputPanelStore.getState().addTask("live-task", "p1", "Live", "bound-loop");

    dispatch({
      type: EventType.LoopFinished,
      project_id: "p1",
      agent_id: "bound-loop",
      content: {},
    } as unknown as AuraEvent);

    const row = useTaskOutputPanelStore.getState().tasks.find((t) => t.taskId === "live-task");
    expect(row?.status).toBe("completed");
  });
});
