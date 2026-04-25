import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "@testing-library/react";
import { useEventStore, getTaskOutput, connectEventSocket } from "./event-store";
import { computeTaskGitSummary } from "../components/TaskPreview/useTaskPreviewData";

const { capture } = vi.hoisted(() => {
  const capture = { onMessage: null as ((data: string) => void) | null };
  return { capture };
});

const sidekickCapture = vi.hoisted(() => ({
  pushSpec: vi.fn(),
  pushTask: vi.fn(),
}));

vi.mock("../shared/hooks/ws-reconnect", () => ({
  createReconnectingWebSocket: (
    _cfg: unknown,
    msgCb: (data: string) => void,
  ) => {
    capture.onMessage = msgCb;
    return { close: () => {} };
  },
}));

vi.mock("../shared/lib/host-config", () => ({
  resolveWsUrl: (path: string) => `ws://localhost${path}`,
}));

vi.mock("../shared/lib/auth-token", () => ({
  getStoredJwt: () => "test-jwt",
}));

vi.mock("./sidekick-store", () => ({
  useSidekickStore: {
    getState: () => sidekickCapture,
  },
}));

function simulateEvent(event: Record<string, unknown>) {
  act(() => {
    capture.onMessage!(JSON.stringify(event));
  });
}

beforeEach(() => {
  useEventStore.setState({ connected: false, lastEventAt: null, taskOutputs: {}, pushStuckByProject: {} });
  sidekickCapture.pushSpec.mockClear();
  sidekickCapture.pushTask.mockClear();
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

  it("seedTaskOutput skips identical output writes", () => {
    const storeListener = vi.fn();
    const unsubscribe = useEventStore.subscribe(storeListener);

    useEventStore.getState().seedTaskOutput("task-same", "Build output...", [
      { kind: "passed", command: "cargo check", timestamp: 123 },
    ]);
    const firstOutputs = useEventStore.getState().taskOutputs;
    expect(storeListener).toHaveBeenCalledTimes(1);

    useEventStore.getState().seedTaskOutput("task-same", "Build output...", [
      { kind: "passed", command: "cargo check", timestamp: 456 },
    ]);

    expect(storeListener).toHaveBeenCalledTimes(1);
    expect(useEventStore.getState().taskOutputs).toBe(firstOutputs);
    unsubscribe();
  });

  it("seedTaskOutput does not overwrite existing output when new text is a prefix of stored text", () => {
    useEventStore.getState().seedTaskOutput("task-2", "Hello world");
    useEventStore.getState().seedTaskOutput("task-2", "Hello");
    const output = getTaskOutput("task-2");
    expect(output.text).toBe("Hello world");
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
      expect.objectContaining({
        type: "task_started",
        content: expect.objectContaining({ task_id: "t3", session_id: "s2" }),
      }),
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

  it("pushes saved artifacts into the sidekick store", () => {
    const spec = { spec_id: "spec-1", title: "Spec" };
    const task = { task_id: "task-1", title: "Task" };

    simulateEvent({ type: "spec_saved", project_id: "proj-1", spec });
    simulateEvent({ type: "task_saved", project_id: "proj-1", task });

    expect(sidekickCapture.pushSpec).toHaveBeenCalledWith(spec);
    expect(sidekickCapture.pushTask).toHaveBeenCalledWith(task);
  });

  it("push_deferred event appends a push_deferred GitStep", () => {
    simulateEvent({
      type: "push_deferred",
      project_id: "proj-1",
      task_id: "t-def-1",
      reason: "remote rejected: No space left on device",
      commit_sha: "abc1234567890",
      class: "remote_rejected",
    });
    const gitSteps = getTaskOutput("t-def-1").gitSteps;
    expect(gitSteps).toHaveLength(1);
    expect(gitSteps[0].kind).toBe("push_deferred");
    expect(gitSteps[0].reason).toBe("remote rejected: No space left on device");
    expect(gitSteps[0].commitSha).toBe("abc1234567890");
  });

  it("push_deferred with remote_storage_exhausted threads class + remediation + retry_after_secs", () => {
    simulateEvent({
      type: "push_deferred",
      project_id: "proj-ex-1",
      task_id: "t-ex-1",
      reason: "remote storage exhausted on git push",
      commit_sha: "cafebabecafebabe",
      class: "remote_storage_exhausted",
      remediation: "Free disk on orbit, then retry.",
      retry_after_secs: 900,
    });
    const step = getTaskOutput("t-ex-1").gitSteps[0];
    expect(step.kind).toBe("push_deferred");
    expect(step.class).toBe("remote_storage_exhausted");
    expect(step.remediation).toBe("Free disk on orbit, then retry.");
    expect(step.retryAfterSecs).toBe(900);
  });

  it("push_deferred with remote_storage_exhausted promotes to project_push_stuck on first event", () => {
    // Without the orbit capacity guard promotion, the per-project
    // banner would only appear after 3 back-to-back failures. ENOSPC
    // is different: each retry makes it worse, so the client has to
    // show the banner immediately off the FIRST `push_deferred` that
    // carries `class: "remote_storage_exhausted"`.
    expect(useEventStore.getState().pushStuckByProject["proj-ex-2"]).toBeUndefined();
    simulateEvent({
      type: "push_deferred",
      project_id: "proj-ex-2",
      task_id: "t-ex-2",
      reason: "remote storage exhausted on git push",
      class: "remote_storage_exhausted",
      remediation: "Free disk on orbit, then retry.",
      retry_after_secs: 600,
    });
    const flag = useEventStore.getState().pushStuckByProject["proj-ex-2"];
    expect(flag).toBeDefined();
    expect(flag!.class).toBe("remote_storage_exhausted");
    expect(flag!.threshold).toBe(1);
    expect(flag!.remediation).toBe("Free disk on orbit, then retry.");
    expect(flag!.retryAfterSecs).toBe(600);
    expect(flag!.dismissed).toBe(false);
  });

  it("push_deferred with a non-storage class does NOT promote to banner", () => {
    simulateEvent({
      type: "push_deferred",
      project_id: "proj-ex-3",
      task_id: "t-ex-3",
      reason: "transient network blip",
      class: "transport_timeout",
    });
    expect(useEventStore.getState().pushStuckByProject["proj-ex-3"]).toBeUndefined();
  });

  it("project_push_stuck event flips a per-project banner flag", () => {
    expect(useEventStore.getState().pushStuckByProject["proj-ps-1"]).toBeUndefined();
    simulateEvent({
      type: "project_push_stuck",
      project_id: "proj-ps-1",
      task_id: "t-ps-1",
      threshold: 3,
      reason: "remote rejected: No space left on device",
      class: "remote_rejected",
    });
    const flag = useEventStore.getState().pushStuckByProject["proj-ps-1"];
    expect(flag).toBeDefined();
    expect(flag!.threshold).toBe(3);
    expect(flag!.reason).toBe("remote rejected: No space left on device");
    expect(flag!.dismissed).toBe(false);
  });

  it("git_pushed clears a previously-set project_push_stuck flag", () => {
    simulateEvent({
      type: "project_push_stuck",
      project_id: "proj-ps-2",
      threshold: 3,
      reason: "stuck",
    });
    expect(useEventStore.getState().pushStuckByProject["proj-ps-2"]).toBeDefined();
    simulateEvent({
      type: "git_pushed",
      project_id: "proj-ps-2",
      task_id: "t-ok-1",
      branch: "main",
      commits: [{ sha: "deadbeef", message: "fix" }],
    });
    expect(useEventStore.getState().pushStuckByProject["proj-ps-2"]).toBeUndefined();
  });

  it("dismissPushStuck marks the banner dismissed without clearing the flag", () => {
    simulateEvent({
      type: "project_push_stuck",
      project_id: "proj-ps-3",
      threshold: 3,
      reason: "stuck",
    });
    useEventStore.getState().dismissPushStuck("proj-ps-3");
    const flag = useEventStore.getState().pushStuckByProject["proj-ps-3"];
    expect(flag).toBeDefined();
    expect(flag!.dismissed).toBe(true);
  });

  it("rollback precedence: commit_rolled_back beats committed in the summary", () => {
    const steps = [
      { kind: "committed" as const, commitSha: "abc1234def5678", timestamp: 1 },
      {
        kind: "commit_rolled_back" as const,
        commitSha: "abc1234def5678",
        reason: "DoD gate rejected: missing tests",
        timestamp: 2,
      },
    ];
    const summary = computeTaskGitSummary(steps, "failed");
    expect(summary).toMatch(/^Rolled back abc1234:/);
    expect(summary).not.toMatch(/^Committed/);
  });

  it("push_deferred surfaces in the git summary when no rollback / push_failed precedes it", () => {
    const steps = [
      { kind: "committed" as const, commitSha: "aaa1111bbbcccc", timestamp: 1 },
      {
        kind: "push_deferred" as const,
        commitSha: "aaa1111bbbcccc",
        reason: "remote rejected: No space left on device",
        timestamp: 2,
      },
    ];
    const summary = computeTaskGitSummary(steps, "done");
    expect(summary).toBe(
      "Push deferred: remote rejected: No space left on device",
    );
  });
});
