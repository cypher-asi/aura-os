import { useEffect } from "react";
import { taskStreamKey } from "../stores/task-stream-bootstrap";
import { ensureEntry, useStreamStore } from "./stream/store";

/**
 * Selects a live task stream slice by `taskId`.
 *
 * All WS event subscriptions for tasks are registered once at app boot
 * by `bootstrapTaskStreamSubscriptions` (see
 * `interface/src/stores/task-stream-bootstrap.ts`). This hook no longer
 * registers its own subscribers — that approach raced with the first
 * batch of events arriving immediately after `TaskStarted` and led to
 * a task row whose body never filled in. The app-scoped subscriptions
 * are in place before the first component mounts, so every task event
 * lands in the stream store regardless of render timing.
 *
 * When `isActive` is `true`, the entry is pre-created and
 * `isStreaming` is set synchronously on mount so the UI does not flash
 * "Waiting for output…" while waiting for the first `TaskStarted`
 * event to arrive (e.g. when the route re-renders a run that is
 * already in progress).
 */
export function useTaskStream(
  taskId: string | undefined,
  isActive?: boolean,
): { streamKey: string } {
  const key = taskId ? taskStreamKey(taskId) : "task:";

  useEffect(() => {
    if (!taskId) return;
    if (!isActive) return;
    ensureEntry(key);
    useStreamStore.setState((s) => {
      const existing = s.entries[key];
      if (!existing || existing.isStreaming) return s;
      return {
        entries: {
          ...s.entries,
          [key]: { ...existing, isStreaming: true },
        },
      };
    });
  }, [taskId, isActive, key]);

  return { streamKey: key };
}
