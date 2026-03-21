import { create } from "zustand";
import type { EngineEvent, EngineEventType } from "../types/events";
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

export interface TaskOutputEntry {
  text: string;
  fileOps: { op: string; path: string }[];
  buildSteps: BuildStep[];
  testSteps: TestStep[];
}

type EventCallback = (event: EngineEvent) => void;
type TaskOutputListener = () => void;

const EMPTY_OUTPUT: TaskOutputEntry = { text: "", fileOps: [], buildSteps: [], testSteps: [] };

const subscribers = new Map<EngineEventType, Set<EventCallback>>();
const taskOutputListeners = new Map<string, Set<TaskOutputListener>>();

interface EventState {
  connected: boolean;
  lastEventAt: number | null;
  taskOutputs: Record<string, TaskOutputEntry>;

  subscribe: (type: EngineEventType, callback: EventCallback) => () => void;
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
    let set = subscribers.get(type);
    if (!set) {
      set = new Set();
      subscribers.set(type, set);
    }
    set.add(callback);
    return () => {
      subscribers.get(type)?.delete(callback);
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
    };
    set({ taskOutputs: { ...taskOutputs, [taskId]: entry } });
    notifyTaskOutputListeners(taskId);
  },
}));

function handleEngineEvent(event: EngineEvent) {
  const { taskOutputs } = useEventStore.getState();
  let updatedOutputs = taskOutputs;
  let outputChanged = false;

  if (event.type === "task_started" && event.task_id) {
    const existing = updatedOutputs[event.task_id];
    if (existing && existing.text) {
      updatedOutputs = { ...updatedOutputs, [event.task_id]: { text: "", fileOps: [], buildSteps: [], testSteps: [] } };
      outputChanged = true;
      notifyTaskOutputListeners(event.task_id);
    }
  }

  if (event.type === "task_output_delta" && event.task_id && event.delta) {
    const existing = updatedOutputs[event.task_id] ?? EMPTY_OUTPUT;
    updatedOutputs = { ...updatedOutputs, [event.task_id]: { ...existing, text: existing.text + event.delta } };
    outputChanged = true;
    notifyTaskOutputListeners(event.task_id);
  }

  if (event.type === "file_ops_applied" && event.task_id && event.files) {
    const existing = updatedOutputs[event.task_id] ?? EMPTY_OUTPUT;
    updatedOutputs = { ...updatedOutputs, [event.task_id]: { ...existing, fileOps: event.files } };
    outputChanged = true;
    notifyTaskOutputListeners(event.task_id);
  }

  if (
    event.task_id &&
    (event.type === "build_verification_skipped" ||
      event.type === "build_verification_started" ||
      event.type === "build_verification_passed" ||
      event.type === "build_verification_failed" ||
      event.type === "build_fix_attempt")
  ) {
    const kindMap: Record<string, BuildStep["kind"]> = {
      build_verification_skipped: "skipped",
      build_verification_started: "started",
      build_verification_passed: "passed",
      build_verification_failed: "failed",
      build_fix_attempt: "fix_attempt",
    };
    const step: BuildStep = {
      kind: kindMap[event.type],
      command: event.command,
      stderr: event.stderr,
      stdout: event.stdout,
      attempt: event.attempt,
      reason: event.reason,
      timestamp: Date.now(),
    };
    const existing = updatedOutputs[event.task_id] ?? EMPTY_OUTPUT;
    updatedOutputs = {
      ...updatedOutputs,
      [event.task_id]: { ...existing, buildSteps: [...existing.buildSteps, step] },
    };
    outputChanged = true;
    notifyTaskOutputListeners(event.task_id);
  }

  if (
    event.task_id &&
    (event.type === "test_verification_started" ||
      event.type === "test_verification_passed" ||
      event.type === "test_verification_failed" ||
      event.type === "test_fix_attempt")
  ) {
    const kindMap: Record<string, TestStep["kind"]> = {
      test_verification_started: "started",
      test_verification_passed: "passed",
      test_verification_failed: "failed",
      test_fix_attempt: "fix_attempt",
    };
    const step: TestStep = {
      kind: kindMap[event.type],
      command: event.command,
      stderr: event.stderr,
      stdout: event.stdout,
      attempt: event.attempt,
      tests: event.tests ?? [],
      summary: event.summary,
      timestamp: Date.now(),
    };
    const existing = updatedOutputs[event.task_id] ?? EMPTY_OUTPUT;
    updatedOutputs = {
      ...updatedOutputs,
      [event.task_id]: { ...existing, testSteps: [...existing.testSteps, step] },
    };
    outputChanged = true;
    notifyTaskOutputListeners(event.task_id);
  }

  if (
    (event.type === "task_completed" || event.type === "task_failed") &&
    event.task_id
  ) {
    notifyTaskOutputListeners(event.task_id);
  }

  if (event.type === "loop_stopped" || event.type === "loop_finished") {
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

/**
 * Subscribe to per-task output changes (used by useTaskOutput).
 * Kept outside the store since it drives useSyncExternalStore-style subscriptions.
 */
export function subscribeTaskOutput(taskId: string, listener: TaskOutputListener): () => void {
  let set = taskOutputListeners.get(taskId);
  if (!set) {
    set = new Set();
    taskOutputListeners.set(taskId, set);
  }
  set.add(listener);
  return () => {
    taskOutputListeners.get(taskId)?.delete(listener);
  };
}

export function getTaskOutput(taskId: string): TaskOutputEntry {
  return useEventStore.getState().taskOutputs[taskId] ?? EMPTY_OUTPUT;
}

export { EMPTY_OUTPUT };

/**
 * Returns the live accumulated output for a task via a Zustand selector.
 * Components can use this directly: `const output = useTaskOutput(taskId)`.
 */
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
        handleEngineEvent(JSON.parse(data));
      } catch {
        // ignore malformed events
      }
    },
    (connected: boolean) => useEventStore.setState({ connected }),
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
