import { create } from "zustand";
import type { AuraEvent, AuraEventOfType } from "../../types/aura-events";
import { EventType, parseAuraEvent } from "../../types/aura-events";
import { getStoredJwt } from "../../lib/auth-token";
import { createReconnectingWebSocket } from "../../hooks/ws-reconnect";
import { resolveWsUrl } from "../../lib/host-config";
import { persistTaskOutputText } from "./task-output-cache";
import { handleEngineEvent } from "./engine-event-handlers";

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

export const EMPTY_OUTPUT: TaskOutputEntry = { text: "", fileOps: [], buildSteps: [], testSteps: [], gitSteps: [] };

export const subscribers = new Map<EventType, Set<EventCallback>>();
const taskOutputListeners = new Map<string, Set<TaskOutputListener>>();

interface EventState {
  connected: boolean;
  lastEventAt: number | null;
  taskOutputs: Record<string, TaskOutputEntry>;

  subscribe: <T extends EventType>(type: T, callback: (event: AuraEventOfType<T>) => void) => () => void;
  seedTaskOutput: (taskId: string, text: string, buildSteps?: BuildStep[], testSteps?: TestStep[], projectId?: string) => void;
}

export function notifyTaskOutputListeners(taskId: string) {
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

  seedTaskOutput: (taskId, text, buildSteps, testSteps, projectId) => {
    if (!text && (!buildSteps || buildSteps.length === 0) && (!testSteps || testSteps.length === 0)) return;
    const { taskOutputs } = get();
    const existing = taskOutputs[taskId];
    const seededBuildSteps = buildSteps?.map((s) => ({ ...s, timestamp: 0 })) ?? existing?.buildSteps ?? [];
    const seededTestSteps = testSteps?.map((s) => ({ ...s, timestamp: 0 })) ?? existing?.testSteps ?? [];
    let mergedText = existing?.text ?? "";
    if (text) {
      if (!mergedText || text.length >= mergedText.length || text.includes(mergedText)) {
        mergedText = text;
      } else if (!mergedText.includes(text)) {
        mergedText = `${mergedText}${text}`;
      }
    }
    const finalBuildSteps = existing?.buildSteps.length ? existing.buildSteps : seededBuildSteps;
    const finalTestSteps = existing?.testSteps.length ? existing.testSteps : seededTestSteps;
    const entry: TaskOutputEntry = {
      text: mergedText,
      fileOps: existing?.fileOps ?? [],
      buildSteps: finalBuildSteps,
      testSteps: finalTestSteps,
      gitSteps: existing?.gitSteps ?? [],
    };
    if (entry.text) persistTaskOutputText(taskId, entry.text, projectId);
    set({ taskOutputs: { ...taskOutputs, [taskId]: entry } });
    notifyTaskOutputListeners(taskId);
  },
}));

export function getTaskOutput(taskId: string): TaskOutputEntry {
  return useEventStore.getState().taskOutputs[taskId] ?? EMPTY_OUTPUT;
}

export function useTaskOutput(taskId: string | undefined): TaskOutputEntry {
  return useEventStore((s) => (taskId ? s.taskOutputs[taskId] : undefined) ?? EMPTY_OUTPUT);
}

let _ws: { close: () => void } | null = null;

export function disconnectEventSocket() {
  _ws?.close();
  _ws = null;
}

export function connectEventSocket() {
  _ws?.close();
  _ws = createReconnectingWebSocket(
    {
      url: (() => {
        const base = resolveWsUrl("/ws/events");
        const jwt = getStoredJwt();
        if (!jwt) return base;
        const sep = base.includes("?") ? "&" : "?";
        return `${base}${sep}token=${encodeURIComponent(jwt)}`;
      })(),
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

// Event socket connection is deferred until after authentication.
// Call connectEventSocket() from the auth store after login/restoreSession.

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _ws?.close();
    _ws = null;
  });
}
