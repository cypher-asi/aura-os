import type { AuraEvent, AuraEventContent } from "../../types/aura-events";
import { EventType } from "../../types/aura-events";
import { useSidekickStore } from "../sidekick-store";
import type { BuildStep, TestStep, GitStep, TaskOutputEntry } from "./event-store";
import { useEventStore, EMPTY_OUTPUT, subscribers, notifyTaskOutputListeners } from "./event-store";
import { persistTaskOutputText, removePersistedTaskOutputText } from "./task-output-cache";

interface OutputUpdate {
  outputs: Record<string, TaskOutputEntry>;
  changed: boolean;
}

type EngineHandler = (event: AuraEvent, u: OutputUpdate) => void;

function handleTaskStarted(event: AuraEvent, u: OutputUpdate): void {
  const { task_id } = event.content as AuraEventContent<EventType.TaskStarted>;
  if (!task_id) return;
  const existing = u.outputs[task_id];
  if (existing?.text) {
    u.outputs = { ...u.outputs, [task_id]: { text: "", fileOps: [], buildSteps: [], testSteps: [], gitSteps: [] } };
    u.changed = true;
    notifyTaskOutputListeners(task_id);
  }
  removePersistedTaskOutputText(task_id);
}

function handleTextDelta(event: AuraEvent, u: OutputUpdate): void {
  const c = event.content as unknown as Record<string, unknown>;
  const taskId = c.task_id as string | undefined;
  const text = (c.text as string | undefined) ?? "";
  if (!taskId || !text) return;
  const existing = u.outputs[taskId] ?? EMPTY_OUTPUT;
  u.outputs = {
    ...u.outputs,
    [taskId]: { ...existing, text: `${existing.text}${text}` },
  };
  u.changed = true;
  notifyTaskOutputListeners(taskId);
}

function handleFileOpsApplied(event: AuraEvent, u: OutputUpdate): void {
  const { task_id, files } = event.content as AuraEventContent<EventType.FileOpsApplied>;
  if (!task_id || !files) return;
  const existing = u.outputs[task_id] ?? EMPTY_OUTPUT;
  u.outputs = { ...u.outputs, [task_id]: { ...existing, fileOps: files } };
  u.changed = true;
  notifyTaskOutputListeners(task_id);
}

function handleBuildVerification(event: AuraEvent, u: OutputUpdate): void {
  const c = event.content as Record<string, unknown>;
  const taskId = c.task_id as string | undefined;
  if (!taskId) return;
  const kindMap: Record<string, BuildStep["kind"]> = {
    [EventType.BuildVerificationSkipped]: "skipped",
    [EventType.BuildVerificationStarted]: "started",
    [EventType.BuildVerificationPassed]: "passed",
    [EventType.BuildVerificationFailed]: "failed",
    [EventType.BuildFixAttempt]: "fix_attempt",
  };
  const step: BuildStep = {
    kind: kindMap[event.type],
    command: c.command as string | undefined,
    stderr: c.stderr as string | undefined,
    stdout: c.stdout as string | undefined,
    attempt: c.attempt as number | undefined,
    reason: c.reason as string | undefined,
    timestamp: Date.now(),
  };
  const existing = u.outputs[taskId] ?? EMPTY_OUTPUT;
  u.outputs = {
    ...u.outputs,
    [taskId]: { ...existing, buildSteps: [...existing.buildSteps, step] },
  };
  u.changed = true;
  notifyTaskOutputListeners(taskId);
}

function handleTestVerification(event: AuraEvent, u: OutputUpdate): void {
  const c = event.content as Record<string, unknown>;
  const taskId = c.task_id as string | undefined;
  if (!taskId) return;
  const kindMap: Record<string, TestStep["kind"]> = {
    [EventType.TestVerificationStarted]: "started",
    [EventType.TestVerificationPassed]: "passed",
    [EventType.TestVerificationFailed]: "failed",
    [EventType.TestFixAttempt]: "fix_attempt",
  };
  const step: TestStep = {
    kind: kindMap[event.type],
    command: c.command as string | undefined,
    stderr: c.stderr as string | undefined,
    stdout: c.stdout as string | undefined,
    attempt: c.attempt as number | undefined,
    tests: (c.tests as TestStep["tests"]) ?? [],
    summary: c.summary as string | undefined,
    timestamp: Date.now(),
  };
  const existing = u.outputs[taskId] ?? EMPTY_OUTPUT;
  u.outputs = {
    ...u.outputs,
    [taskId]: { ...existing, testSteps: [...existing.testSteps, step] },
  };
  u.changed = true;
  notifyTaskOutputListeners(taskId);
}

function appendGitStep(taskId: string, step: GitStep, u: OutputUpdate): void {
  const existing = u.outputs[taskId] ?? EMPTY_OUTPUT;
  u.outputs = { ...u.outputs, [taskId]: { ...existing, gitSteps: [...existing.gitSteps, step] } };
  u.changed = true;
  notifyTaskOutputListeners(taskId);
}

function handleGitCommitted(event: AuraEvent, u: OutputUpdate): void {
  const c = event.content as AuraEventContent<EventType.GitCommitted>;
  if (!c.task_id) return;
  appendGitStep(c.task_id, { kind: "committed", commitSha: c.commit_sha, timestamp: Date.now() }, u);
}

function handleGitCommitFailed(event: AuraEvent, u: OutputUpdate): void {
  const c = event.content as AuraEventContent<EventType.GitCommitFailed>;
  if (!c.task_id) return;
  appendGitStep(c.task_id, { kind: "commit_failed", reason: c.reason, timestamp: Date.now() }, u);
}

function handleGitPushed(event: AuraEvent, u: OutputUpdate): void {
  const c = event.content as AuraEventContent<EventType.GitPushed>;
  if (!c.task_id) return;
  appendGitStep(c.task_id, {
    kind: "pushed",
    repo: c.repo,
    branch: c.branch,
    commits: c.commits,
    timestamp: Date.now(),
  }, u);
}

function handleGitPushFailed(event: AuraEvent, u: OutputUpdate): void {
  const c = event.content as AuraEventContent<EventType.GitPushFailed>;
  if (!c.task_id) return;
  appendGitStep(c.task_id, { kind: "push_failed", reason: c.reason, timestamp: Date.now() }, u);
}

function handleTaskFinish(event: AuraEvent, u: OutputUpdate): void {
  const c = event.content as { task_id: string };
  if (!c.task_id) return;
  const existing = u.outputs[c.task_id];
  if (existing?.text) persistTaskOutputText(c.task_id, existing.text, event.project_id);
  notifyTaskOutputListeners(c.task_id);
}

function handleSpecSaved(event: AuraEvent, _u: OutputUpdate): void {
  const spec = (event.content as AuraEventContent<EventType.SpecSaved>).spec;
  if (!spec) return;
  useSidekickStore.getState().pushSpec(spec);
}

function handleTaskSaved(event: AuraEvent, _u: OutputUpdate): void {
  const task = (event.content as AuraEventContent<EventType.TaskSaved>).task;
  if (!task) return;
  useSidekickStore.getState().pushTask(task);
}

function handleLoopEnd(_event: AuraEvent, u: OutputUpdate): void {
  for (const taskId of Object.keys(u.outputs)) {
    notifyTaskOutputListeners(taskId);
  }
}

const DISPATCH: Partial<Record<EventType, EngineHandler>> = {
  [EventType.TaskStarted]: handleTaskStarted,
  [EventType.TextDelta]: handleTextDelta,
  [EventType.FileOpsApplied]: handleFileOpsApplied,
  [EventType.BuildVerificationSkipped]: handleBuildVerification,
  [EventType.BuildVerificationStarted]: handleBuildVerification,
  [EventType.BuildVerificationPassed]: handleBuildVerification,
  [EventType.BuildVerificationFailed]: handleBuildVerification,
  [EventType.BuildFixAttempt]: handleBuildVerification,
  [EventType.TestVerificationStarted]: handleTestVerification,
  [EventType.TestVerificationPassed]: handleTestVerification,
  [EventType.TestVerificationFailed]: handleTestVerification,
  [EventType.TestFixAttempt]: handleTestVerification,
  [EventType.GitCommitted]: handleGitCommitted,
  [EventType.GitCommitFailed]: handleGitCommitFailed,
  [EventType.GitPushed]: handleGitPushed,
  [EventType.GitPushFailed]: handleGitPushFailed,
  [EventType.SpecSaved]: handleSpecSaved,
  [EventType.TaskSaved]: handleTaskSaved,
  [EventType.TaskCompleted]: handleTaskFinish,
  [EventType.TaskFailed]: handleTaskFinish,
  [EventType.LoopStopped]: handleLoopEnd,
  [EventType.LoopFinished]: handleLoopEnd,
};

export function handleEngineEvent(event: AuraEvent): void {
  const { taskOutputs } = useEventStore.getState();
  const u: OutputUpdate = { outputs: taskOutputs, changed: false };

  const handler = DISPATCH[event.type];
  if (handler) handler(event, u);

  useEventStore.setState({
    lastEventAt: Date.now(),
    ...(u.changed ? { taskOutputs: u.outputs } : {}),
  });

  const subs = subscribers.get(event.type);
  if (subs) subs.forEach((cb) => cb(event));
}
