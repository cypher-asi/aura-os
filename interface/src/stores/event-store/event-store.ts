import { create } from "zustand";
import type { AuraEvent, AuraEventOfType } from "../../shared/types/aura-events";
import { EventType, parseAuraEvent } from "../../shared/types/aura-events";
import { getStoredJwt } from "../../shared/lib/auth-token";
import { createReconnectingWebSocket } from "../../shared/hooks/ws-reconnect";
import { resolveWsUrl } from "../../shared/lib/host-config";
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
  kind:
    | "committed"
    | "commit_failed"
    | "commit_rolled_back"
    | "pushed"
    | "push_failed"
    | "push_deferred";
  commitSha?: string;
  reason?: string;
  repo?: string;
  branch?: string;
  commits?: { sha: string; message: string }[];
  /** Server classifier for `push_failed` / `push_deferred` rows so the
   *  UI can route `remote_storage_exhausted` to a dedicated message
   *  instead of showing the raw `No space left on device` error. */
  class?: string;
  /** Remediation hint provided by the backend (see `orbit_guard`). */
  remediation?: string;
  /** When orbit is in cooldown, seconds until retries resume. */
  retryAfterSecs?: number;
  timestamp: number;
}

export interface TaskOutputEntry {
  text: string;
  fileOps: { op: string; path: string }[];
  buildSteps: BuildStep[];
  testSteps: TestStep[];
  gitSteps: GitStep[];
}

/**
 * Per-project advisory emitted by the dev loop when a project accumulates
 * CONSECUTIVE_PUSH_FAILURES_STUCK_THRESHOLD back-to-back push failures.
 * Rendered as a persistent banner in the project header until a successful
 * push clears it, or the user dismisses it for the current session.
 */
export interface PushStuckInfo {
  /** Classified failure reason (e.g. `remote_rejected`). */
  reason?: string;
  /** Backend failure class label when present
   *  (e.g. `transport_timeout`, `remote_storage_exhausted`). */
  class?: string;
  /** Streak threshold the backend observed when emitting the advisory. */
  threshold: number;
  /** Operator-facing remediation hint when the backend knows what to
   *  do (currently populated for `remote_storage_exhausted`). */
  remediation?: string;
  /** Seconds until the orbit capacity guard releases retries. */
  retryAfterSecs?: number;
  /** Set after the user dismisses the banner for the current session. */
  dismissed: boolean;
  /** ms-epoch of the most recent advisory for this project. */
  lastAt: number;
}

type EventCallback = (event: AuraEvent) => void;
type TaskOutputListener = () => void;

export const EMPTY_OUTPUT: TaskOutputEntry = { text: "", fileOps: [], buildSteps: [], testSteps: [], gitSteps: [] };

export const subscribers = new Map<EventType, Set<EventCallback>>();
const taskOutputListeners = new Map<string, Set<TaskOutputListener>>();

function sameJsonValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameTaskOutputEntry(a: TaskOutputEntry | undefined, b: TaskOutputEntry): boolean {
  if (!a) return false;
  return (
    a.text === b.text &&
    sameJsonValue(a.fileOps, b.fileOps) &&
    sameJsonValue(a.buildSteps, b.buildSteps) &&
    sameJsonValue(a.testSteps, b.testSteps) &&
    sameJsonValue(a.gitSteps, b.gitSteps)
  );
}

interface EventState {
  connected: boolean;
  lastEventAt: number | null;
  taskOutputs: Record<string, TaskOutputEntry>;
  /**
   * Keyed by \project_id\. Populated by the \project_push_stuck\ domain
   * event and cleared on a subsequent \git_pushed\ for the same project.
   */
  pushStuckByProject: Record<string, PushStuckInfo | undefined>;

  subscribe: <T extends EventType>(type: T, callback: (event: AuraEventOfType<T>) => void) => () => void;
  seedTaskOutput: (taskId: string, text: string, buildSteps?: BuildStep[], testSteps?: TestStep[], gitSteps?: GitStep[], projectId?: string) => void;
  setPushStuck: (projectId: string, info: Omit<PushStuckInfo, "dismissed" | "lastAt"> & Partial<Pick<PushStuckInfo, "dismissed" | "lastAt">>) => void;
  clearPushStuck: (projectId: string) => void;
  dismissPushStuck: (projectId: string) => void;
}

export function notifyTaskOutputListeners(taskId: string) {
  const listeners = taskOutputListeners.get(taskId);
  if (listeners) listeners.forEach((fn) => fn());
}

export const useEventStore = create<EventState>()((set, get) => ({
  connected: false,
  lastEventAt: null,
  taskOutputs: {},
  pushStuckByProject: {},

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

  seedTaskOutput: (taskId, text, buildSteps, testSteps, gitSteps, projectId) => {
    if (!text && (!buildSteps || buildSteps.length === 0) && (!testSteps || testSteps.length === 0) && (!gitSteps || gitSteps.length === 0)) return;
    const { taskOutputs } = get();
    const existing = taskOutputs[taskId];
    const seededBuildSteps = buildSteps?.map((s) => ({ ...s, timestamp: 0 })) ?? existing?.buildSteps ?? [];
    const seededTestSteps = testSteps?.map((s) => ({ ...s, timestamp: 0 })) ?? existing?.testSteps ?? [];
    const seededGitSteps = gitSteps?.map((s) => ({ ...s, timestamp: 0 })) ?? existing?.gitSteps ?? [];
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
      gitSteps: seededGitSteps,
    };
    if (sameTaskOutputEntry(existing, entry)) return;
    if (entry.text) persistTaskOutputText(taskId, entry.text, projectId);
    set({ taskOutputs: { ...taskOutputs, [taskId]: entry } });
    notifyTaskOutputListeners(taskId);
  },

  setPushStuck: (projectId, info) => {
    if (!projectId) return;
    set((state) => ({
      pushStuckByProject: {
        ...state.pushStuckByProject,
        [projectId]: {
          threshold: info.threshold,
          reason: info.reason,
          class: info.class,
          remediation: info.remediation,
          retryAfterSecs: info.retryAfterSecs,
          dismissed: info.dismissed ?? state.pushStuckByProject[projectId]?.dismissed ?? false,
          lastAt: info.lastAt ?? Date.now(),
        },
      },
    }));
  },

  clearPushStuck: (projectId) => {
    if (!projectId) return;
    set((state) => {
      if (!(projectId in state.pushStuckByProject)) return state;
      const next = { ...state.pushStuckByProject };
      delete next[projectId];
      return { pushStuckByProject: next };
    });
  },

  dismissPushStuck: (projectId) => {
    if (!projectId) return;
    set((state) => {
      const existing = state.pushStuckByProject[projectId];
      if (!existing || existing.dismissed) return state;
      return {
        pushStuckByProject: {
          ...state.pushStuckByProject,
          [projectId]: { ...existing, dismissed: true },
        },
      };
    });
  },
}));

/** Reactive selector for the current push-stuck state of a project. */
export function usePushStuck(projectId: string | undefined): PushStuckInfo | null {
  return useEventStore((s) => (projectId ? s.pushStuckByProject[projectId] ?? null : null));
}

export function getTaskOutput(taskId: string): TaskOutputEntry {
  return useEventStore.getState().taskOutputs[taskId] ?? EMPTY_OUTPUT;
}

export function useTaskOutput(taskId: string | undefined): TaskOutputEntry {
  return useEventStore((s) => (taskId ? s.taskOutputs[taskId] : undefined) ?? EMPTY_OUTPUT);
}

let _ws: { close: () => void } | null = null;

/** Pending idle/timer handle for deferred connect (cancel on logout / disconnect). */
let _deferredConnectHandle: number | undefined;
let _engineEventFrame: number | null = null;
const queuedEngineEvents: AuraEvent[] = [];

const IMMEDIATE_ENGINE_EVENTS = new Set<EventType>([
  EventType.TaskStarted,
  EventType.TaskCompleted,
  EventType.TaskFailed,
  EventType.LoopStopped,
  EventType.LoopFinished,
  EventType.LoopEnded,
]);

function canScheduleEngineEventFrame(): boolean {
  return (
    import.meta.env.MODE !== "test" &&
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function" &&
    typeof window.cancelAnimationFrame === "function"
  );
}

function flushQueuedEngineEvents(): void {
  _engineEventFrame = null;
  const events = queuedEngineEvents.splice(0);
  for (const event of events) {
    handleEngineEvent(event);
  }
}

function cancelQueuedEngineEventFrame(): void {
  if (_engineEventFrame === null || !canScheduleEngineEventFrame()) {
    _engineEventFrame = null;
    return;
  }
  window.cancelAnimationFrame(_engineEventFrame);
  _engineEventFrame = null;
}

function handleSocketEngineEvent(event: AuraEvent): void {
  if (!canScheduleEngineEventFrame()) {
    handleEngineEvent(event);
    return;
  }

  if (IMMEDIATE_ENGINE_EVENTS.has(event.type)) {
    cancelQueuedEngineEventFrame();
    flushQueuedEngineEvents();
    handleEngineEvent(event);
    return;
  }

  queuedEngineEvents.push(event);
  if (_engineEventFrame === null) {
    _engineEventFrame = window.requestAnimationFrame(flushQueuedEngineEvents);
  }
}

function cancelDeferredEventSocketConnect(): void {
  if (_deferredConnectHandle === undefined) return;
  const id = _deferredConnectHandle;
  _deferredConnectHandle = undefined;
  if (typeof window === "undefined") return;
  const w = window as Window & { cancelIdleCallback?: (handle: number) => void };
  if (typeof w.cancelIdleCallback === "function") {
    try {
      w.cancelIdleCallback(id);
    } catch {
      clearTimeout(id);
    }
  } else {
    clearTimeout(id);
  }
}

/**
 * Opens the events WebSocket after the browser is idle (or soon via timeout),
 * so handshake and reconnect timers do not compete with first paint / shell work.
 */
export function scheduleDeferredEventSocketConnect(): void {
  cancelDeferredEventSocketConnect();
  const run = () => {
    _deferredConnectHandle = undefined;
    connectEventSocket();
  };
  if (typeof window === "undefined") {
    run();
    return;
  }
  const w = window as Window & {
    requestIdleCallback?: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number;
  };
  if (typeof w.requestIdleCallback === "function") {
    _deferredConnectHandle = w.requestIdleCallback(run, { timeout: 2500 });
  } else {
    _deferredConnectHandle = window.setTimeout(run, 0) as unknown as number;
  }
}

export function disconnectEventSocket() {
  cancelDeferredEventSocketConnect();
  cancelQueuedEngineEventFrame();
  flushQueuedEngineEvents();
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
        handleSocketEngineEvent(event);
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn("Dropped malformed WS event payload", { error, data });
        }
      }
    },
    (connected: boolean) => {
      useEventStore.setState({ connected });
      // On every (re)connect, snapshot the server's `LoopRegistry` so
      // the unified circular progress indicator is accurate even if we
      // missed a `loop_activity_changed` event during the disconnect.
      if (connected) {
        // Lazy import so the event-store module has no hard dependency
        // on the loop activity store during initial bundle parsing.
        void import("../loop-activity-store").then(
          ({ useLoopActivityStore, startLoopActivityWatchdog }) => {
            void useLoopActivityStore.getState().hydrate();
            startLoopActivityWatchdog();
          },
        );
      }
    },
  );
}

// Prefer scheduleDeferredEventSocketConnect() from auth after session/login so
// the socket does not compete with startup; connectEventSocket() is still used for tests.

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cancelQueuedEngineEventFrame();
    flushQueuedEngineEvents();
    _ws?.close();
    _ws = null;
  });
}
