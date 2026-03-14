import { createContext, useContext, useCallback, useRef, useSyncExternalStore } from "react";
import type { EngineEvent, EngineEventType } from "../types/events";
import { useEventStream } from "../hooks/use-event-stream";

type EventCallback = (event: EngineEvent) => void;

export interface BuildStep {
  kind: "started" | "passed" | "failed" | "fix_attempt";
  command?: string;
  stderr?: string;
  stdout?: string;
  attempt?: number;
  timestamp: number;
}

export interface TaskOutputEntry {
  text: string;
  fileOps: { op: string; path: string }[];
  buildSteps: BuildStep[];
}

type TaskOutputListener = () => void;

interface EventContextValue {
  connected: boolean;
  events: EngineEvent[];
  latestEvent: EngineEvent | null;
  subscribe: (type: EngineEventType, callback: EventCallback) => () => void;
  getTaskOutput: (taskId: string) => TaskOutputEntry;
  subscribeTaskOutput: (taskId: string, listener: TaskOutputListener) => () => void;
  seedTaskOutput: (taskId: string, text: string) => void;
}

const EMPTY_OUTPUT: TaskOutputEntry = { text: "", fileOps: [], buildSteps: [] };

const EventContext = createContext<EventContextValue | null>(null);

export function EventProvider({ children }: { children: React.ReactNode }) {
  const subscribersRef = useRef<Map<EngineEventType, Set<EventCallback>>>(new Map());

  const taskOutputRef = useRef<Map<string, TaskOutputEntry>>(new Map());
  const taskOutputListenersRef = useRef<Map<string, Set<TaskOutputListener>>>(new Map());

  const notifyTaskOutputListeners = useCallback((taskId: string) => {
    const listeners = taskOutputListenersRef.current.get(taskId);
    if (listeners) listeners.forEach((fn) => fn());
  }, []);

  const dispatchEvent = useCallback((event: EngineEvent) => {
    if (event.type === "task_output_delta" && event.task_id && event.delta) {
      const map = taskOutputRef.current;
      const existing = map.get(event.task_id) ?? { text: "", fileOps: [], buildSteps: [] };
      map.set(event.task_id, { ...existing, text: existing.text + event.delta });
      notifyTaskOutputListeners(event.task_id);
    }

    if (event.type === "file_ops_applied" && event.task_id && event.files) {
      const map = taskOutputRef.current;
      const existing = map.get(event.task_id) ?? { text: "", fileOps: [], buildSteps: [] };
      map.set(event.task_id, { ...existing, fileOps: event.files });
      notifyTaskOutputListeners(event.task_id);
    }

    if (event.task_id && (
      event.type === "build_verification_started" ||
      event.type === "build_verification_passed" ||
      event.type === "build_verification_failed" ||
      event.type === "build_fix_attempt"
    )) {
      const kindMap: Record<string, BuildStep["kind"]> = {
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
        timestamp: Date.now(),
      };
      const map = taskOutputRef.current;
      const existing = map.get(event.task_id) ?? { text: "", fileOps: [], buildSteps: [] };
      map.set(event.task_id, { ...existing, buildSteps: [...existing.buildSteps, step] });
      notifyTaskOutputListeners(event.task_id);
    }

    if (
      (event.type === "task_completed" || event.type === "task_failed") &&
      event.task_id
    ) {
      notifyTaskOutputListeners(event.task_id);
    }

    if (event.type === "loop_stopped" || event.type === "loop_finished") {
      for (const taskId of taskOutputRef.current.keys()) {
        notifyTaskOutputListeners(taskId);
      }
    }

    const subs = subscribersRef.current.get(event.type);
    if (subs) subs.forEach((cb) => cb(event));
  }, [notifyTaskOutputListeners]);

  const stream = useEventStream(dispatchEvent);

  const subscribe = useCallback(
    (type: EngineEventType, callback: EventCallback) => {
      const map = subscribersRef.current;
      if (!map.has(type)) {
        map.set(type, new Set());
      }
      map.get(type)!.add(callback);

      return () => {
        map.get(type)?.delete(callback);
      };
    },
    [],
  );

  const getTaskOutput = useCallback((taskId: string): TaskOutputEntry => {
    return taskOutputRef.current.get(taskId) ?? EMPTY_OUTPUT;
  }, []);

  const subscribeTaskOutput = useCallback(
    (taskId: string, listener: TaskOutputListener) => {
      const map = taskOutputListenersRef.current;
      if (!map.has(taskId)) {
        map.set(taskId, new Set());
      }
      map.get(taskId)!.add(listener);
      return () => {
        map.get(taskId)?.delete(listener);
      };
    },
    [],
  );

  const seedTaskOutput = useCallback(
    (taskId: string, text: string) => {
      if (!text) return;
      const existing = taskOutputRef.current.get(taskId);
      if (existing && existing.text) return;
      taskOutputRef.current.set(taskId, { text, fileOps: existing?.fileOps ?? [], buildSteps: existing?.buildSteps ?? [] });
      notifyTaskOutputListeners(taskId);
    },
    [notifyTaskOutputListeners],
  );

  return (
    <EventContext.Provider
      value={{
        connected: stream.connected,
        events: stream.events,
        latestEvent: stream.latestEvent,
        subscribe,
        getTaskOutput,
        subscribeTaskOutput,
        seedTaskOutput,
      }}
    >
      {children}
    </EventContext.Provider>
  );
}

export function useEventContext(): EventContextValue {
  const ctx = useContext(EventContext);
  if (!ctx) {
    throw new Error("useEventContext must be used within an EventProvider");
  }
  return ctx;
}

/**
 * Returns the live accumulated output for a task, re-rendering automatically
 * whenever new deltas arrive.
 */
export function useTaskOutput(taskId: string | undefined): TaskOutputEntry {
  const { getTaskOutput, subscribeTaskOutput } = useEventContext();

  const subscribeFn = useCallback(
    (onStoreChange: () => void) => {
      if (!taskId) return () => {};
      return subscribeTaskOutput(taskId, onStoreChange);
    },
    [taskId, subscribeTaskOutput],
  );

  const getSnapshot = useCallback(() => {
    if (!taskId) return EMPTY_OUTPUT;
    return getTaskOutput(taskId);
  }, [taskId, getTaskOutput]);

  return useSyncExternalStore(subscribeFn, getSnapshot);
}
