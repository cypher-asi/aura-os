import { create } from "zustand";
import type { AuraEvent, AuraEventOfType } from "../types/aura-events";
import { EventType, parseAuraEvent } from "../types/aura-events";
import { createReconnectingWebSocket } from "../hooks/ws-reconnect";
import { resolveWsUrl } from "../lib/host-config";

export interface BuildStep {
  kind: "started" | "passed" | "failed" | "fix_attempt" | "skipped";
  command?: string;
  stderr?: string;
  stdout?: string;
  attempt?: number;
  reason?: string;
  timestamp: number;
}

export interface TestStep {
  kind: "started" | "passed" | "failed" | "fix_attempt";
  command?: string;
  stderr?: string;
  stdout?: string;
  attempt?: number;
  tests: { name: string; status: string; message?: string }[];
  summary?: string;
  timestamp: number;
}

export interface GitStep {
  kind: "committed" | "commit_failed" | "pushed" | "push_failed";
  commitSha?: string;
  reason?: string;
  repo?: string;
  branch?: string;
  commits?: { sha: string; message: string }[];
  timestamp: number;
}

export interface TaskOutputEntry {
  text: string;
  fileOps: { op: string; path: string }[];
  buildSteps: BuildStep[];
  testSteps: TestStep[];
  gitSteps: GitStep[];
}

type EventCallback = (event: AuraEvent) => void;
type TaskOutputListener = () => void;

const EMPTY_OUTPUT: TaskOutputEntry = { text: "", fileOps: [], buildSteps: [], testSteps: [], gitSteps: [] };

const subscribers = new Map<EventType, Set<EventCallback>>();
const taskOutputListeners = new Map<string, Set<TaskOutputListener>>();

function debugLog(hypothesisId: string, location: string, message: string, data: Record<string, unknown>) {
  // #region agent log
  fetch("http://127.0.0.1:7836/ingest/c96ab900-9f38-42f7-81b1-bd596c64b5c4", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "b85524",
    },
    body: JSON.stringify({
      sessionId: "b85524",
      runId: "initial",
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

interface EventState {
  connected: boolean;
  lastEventAt: number | null;
  taskOutputs: Record<string, TaskOutputEntry>;

  subscribe: <T extends EventType>(type: T, callback: (event: AuraEventOfType<T>) => void) => () => void;
  seedTaskOutput: (taskId: string, text: string, buildSteps?: BuildStep[], testSteps?: TestStep[]) => void;
}

function notifyTaskOutputListeners(taskId: string) {
  const listeners = taskOutputListeners.get(taskId);
  if (listeners) listeners.forEach((fn) => fn());
}

export const useEventStore = create<EventState>()((set, get) => ({
  connected: false,
  lastEventAt: null,
  taskOutputs: {},

  subscribe: (type, callback) => {
    let s = subscribers.get(type);
    if (!s) {
      s = new Set();
      subscribers.set(type, s);
    }
    s.add(callback as EventCallback);
    return () => {
      subscribers.get(type)?.delete(callback as EventCallback);
    };
  },

  seedTaskOutput: (taskId, text, buildSteps, testSteps) => {
    if (!text && (!buildSteps || buildSteps.length === 0) && (!testSteps || testSteps.length === 0)) return;
    const { taskOutputs } = get();
    const existing = taskOutputs[taskId];
    if (existing && existing.text) return;
    const seededBuildSteps = buildSteps?.map((s) => ({ ...s, timestamp: 0 })) ?? existing?.buildSteps ?? [];
    const seededTestSteps = testSteps?.map((s) => ({ ...s, timestamp: 0 })) ?? existing?.testSteps ?? [];
    const entry: TaskOutputEntry = {
      text: text || existing?.text || "",
      fileOps: existing?.fileOps ?? [],
      buildSteps: existing?.buildSteps.length ? existing.buildSteps : seededBuildSteps,
      testSteps: existing?.testSteps.length ? existing.testSteps : seededTestSteps,
      gitSteps: existing?.gitSteps ?? [],
    };
    set({ taskOutputs: { ...taskOutputs, [taskId]: entry } });
    notifyTaskOutputListeners(taskId);
  },
}));

function handleEngineEvent(event: AuraEvent) {
  if (
    event.type === EventType.TaskStarted ||
    event.type === EventType.TextDelta ||
    event.type === EventType.ThinkingDelta ||
    event.type === EventType.Progress
  ) {
    const c = event.content as Record<string, unknown>;
    debugLog("H2", "event-store.ts:112", "WS event parsed in store", {
      eventType: event.type,
      taskId: (c.task_id as string | undefined) ?? null,
      hasText: typeof c.text === "string" && (c.text as string).length > 0,
    });
  }

  const { taskOutputs } = useEventStore.getState();
  let updatedOutputs = taskOutputs;
  let outputChanged = false;

  if (event.type === EventType.TaskStarted) {
    const { task_id } = event.content;
    if (task_id) {
      const existing = updatedOutputs[task_id];
      debugLog("H5", "event-store.ts:127", "TaskStarted received in store", {
        taskId: task_id,
        existingTextLength: existing?.text.length ?? 0,
      });
      if (existing && existing.text) {
        updatedOutputs = { ...updatedOutputs, [task_id]: { text: "", fileOps: [], buildSteps: [], testSteps: [], gitSteps: [] } };
        outputChanged = true;
        notifyTaskOutputListeners(task_id);
      }
    }
  }

  if (event.type === EventType.FileOpsApplied) {
    const { task_id, files } = event.content;
    if (task_id && files) {
      const existing = updatedOutputs[task_id] ?? EMPTY_OUTPUT;
      updatedOutputs = { ...updatedOutputs, [task_id]: { ...existing, fileOps: files } };
      outputChanged = true;
      notifyTaskOutputListeners(task_id);
    }
  }

  if (
    event.type === EventType.BuildVerificationSkipped ||
    event.type === EventType.BuildVerificationStarted ||
    event.type === EventType.BuildVerificationPassed ||
    event.type === EventType.BuildVerificationFailed ||
    event.type === EventType.BuildFixAttempt
  ) {
    const c = event.content as Record<string, unknown>;
    const taskId = c.task_id as string | undefined;
    if (taskId) {
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
      const existing = updatedOutputs[taskId] ?? EMPTY_OUTPUT;
      updatedOutputs = {
        ...updatedOutputs,
        [taskId]: { ...existing, buildSteps: [...existing.buildSteps, step] },
      };
      outputChanged = true;
      notifyTaskOutputListeners(taskId);
    }
  }

  if (
    event.type === EventType.TestVerificationStarted ||
    event.type === EventType.TestVerificationPassed ||
    event.type === EventType.TestVerificationFailed ||
    event.type === EventType.TestFixAttempt
  ) {
    const c = event.content as Record<string, unknown>;
    const taskId = c.task_id as string | undefined;
    if (taskId) {
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
      const existing = updatedOutputs[taskId] ?? EMPTY_OUTPUT;
      updatedOutputs = {
        ...updatedOutputs,
        [taskId]: { ...existing, testSteps: [...existing.testSteps, step] },
      };
      outputChanged = true;
      notifyTaskOutputListeners(taskId);
    }
  }

  if (event.type === EventType.GitCommitted) {
    const c = event.content;
    const taskId = c.task_id;
    if (taskId) {
      const step: GitStep = { kind: "committed", commitSha: c.commit_sha, timestamp: Date.now() };
      const existing = updatedOutputs[taskId] ?? EMPTY_OUTPUT;
      updatedOutputs = { ...updatedOutputs, [taskId]: { ...existing, gitSteps: [...existing.gitSteps, step] } };
      outputChanged = true;
      notifyTaskOutputListeners(taskId);
    }
  }

  if (event.type === EventType.GitCommitFailed) {
    const c = event.content;
    const taskId = c.task_id;
    if (taskId) {
      const step: GitStep = { kind: "commit_failed", reason: c.reason, timestamp: Date.now() };
      const existing = updatedOutputs[taskId] ?? EMPTY_OUTPUT;
      updatedOutputs = { ...updatedOutputs, [taskId]: { ...existing, gitSteps: [...existing.gitSteps, step] } };
      outputChanged = true;
      notifyTaskOutputListeners(taskId);
    }
  }

  if (event.type === EventType.GitPushed) {
    const c = event.content;
    const taskId = c.task_id;
    if (taskId) {
      const step: GitStep = {
        kind: "pushed",
        repo: c.repo,
        branch: c.branch,
        commits: c.commits,
        timestamp: Date.now(),
      };
      const existing = updatedOutputs[taskId] ?? EMPTY_OUTPUT;
      updatedOutputs = { ...updatedOutputs, [taskId]: { ...existing, gitSteps: [...existing.gitSteps, step] } };
      outputChanged = true;
      notifyTaskOutputListeners(taskId);
    }
  }

  if (event.type === EventType.GitPushFailed) {
    const c = event.content;
    const taskId = c.task_id;
    if (taskId) {
      const step: GitStep = { kind: "push_failed", reason: c.reason, timestamp: Date.now() };
      const existing = updatedOutputs[taskId] ?? EMPTY_OUTPUT;
      updatedOutputs = { ...updatedOutputs, [taskId]: { ...existing, gitSteps: [...existing.gitSteps, step] } };
      outputChanged = true;
      notifyTaskOutputListeners(taskId);
    }
  }

  if (
    (event.type === EventType.TaskCompleted || event.type === EventType.TaskFailed)
  ) {
    const c = event.content as { task_id: string };
    if (c.task_id) notifyTaskOutputListeners(c.task_id);
  }

  if (event.type === EventType.LoopStopped || event.type === EventType.LoopFinished) {
    for (const taskId of Object.keys(updatedOutputs)) {
      notifyTaskOutputListeners(taskId);
    }
  }

  useEventStore.setState({
    lastEventAt: Date.now(),
    ...(outputChanged ? { taskOutputs: updatedOutputs } : {}),
  });

  const subs = subscribers.get(event.type);
  if (subs) subs.forEach((cb) => cb(event));
}

export function getTaskOutput(taskId: string): TaskOutputEntry {
  return useEventStore.getState().taskOutputs[taskId] ?? EMPTY_OUTPUT;
}

export { EMPTY_OUTPUT };

export function useTaskOutput(taskId: string | undefined): TaskOutputEntry {
  return useEventStore((s) => (taskId ? s.taskOutputs[taskId] : undefined) ?? EMPTY_OUTPUT);
}

let _ws: { close: () => void } | null = null;

function connectEventSocket() {
  _ws?.close();
  _ws = createReconnectingWebSocket(
    {
      url: resolveWsUrl("/ws/events"),
      initialDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2,
    },
    (data: string) => {
      try {
        const raw = JSON.parse(data) as Record<string, unknown>;
        const event = parseAuraEvent(
          raw.type as string,
          raw,
          {
            session_id: raw.session_id as string | undefined,
            project_id: raw.project_id as string | undefined,
            agent_id: raw.agent_instance_id as string | undefined,
          },
        );
        handleEngineEvent(event);
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn("Dropped malformed WS event payload", { error, data });
        }
      }
    },
    (connected: boolean) => {
      useEventStore.setState({ connected });
    },
  );
}

if (typeof window !== "undefined") {
  connectEventSocket();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _ws?.close();
    _ws = null;
  });
}
