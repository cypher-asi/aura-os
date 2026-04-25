import { useCallback } from "react";
import {
  useTaskStatusStore,
  EMPTY_TASK_LIVE,
} from "../stores/task-status-store";

interface TaskStatusState {
  liveStatus: string | null;
  liveSessionId: string | null;
  failReason: string | null;
  setLiveStatus: (status: string | null) => void;
  setFailReason: (reason: string | null) => void;
}

/**
 * Reactive view of a single task's live status.
 *
 * This hook is a thin projection over {@link useTaskStatusStore}: the
 * underlying live values (`liveStatus`, `liveSessionId`,
 * `liveFailReason`) are written exactly once per WS event by the
 * handlers registered in `task-stream-bootstrap.ts`, and every
 * consumer of `useTaskStatus` for the same `taskId` reads the same
 * slice. That eliminates the previous architecture's per-component
 * `useState` + `useEffect` subscription stack, which created N
 * independent copies of the same data and required a render-time
 * effect to mirror props (`task.execution_notes`) into local state.
 * The mirror effect is what produced the "Maximum update depth
 * exceeded" crash in the sidekick after `handleRetry` cleared
 * `failReason` to `null` and then promptly re-seeded it from the
 * still-present prop.
 *
 * Reconciliation against the canonical DB status and fallback to
 * persisted `tasks.execution_notes` happen as **derived** values
 * during render — no setState, no effect, no feedback loop.
 *
 * The two imperative setters are still exposed because
 * `useTaskPreviewData.handleRetry` needs to optimistically flip the
 * UI back to "ready" before the next `task_started` event arrives.
 * They forward to the store, so all observers see the change.
 */
export function useTaskStatus(
  taskId: string,
  canonicalStatus?: string,
  /**
   * Persisted `tasks.execution_notes` for this task. When the task is
   * canonically `failed` and no live `task_failed` event has fired
   * (the common case after a page reload), the hook surfaces this
   * value as `failReason` so the failure banner and the "Copy All
   * Output" markdown in {@link TaskOutputSection} still render a
   * reason. A live event always wins because `liveFailReason` is
   * checked first.
   *
   * Pass `undefined` or `null` when no server-side reason is
   * available; `failReason` then stays `null`.
   */
  canonicalExecutionNotes?: string | null,
): TaskStatusState {
  const live = useTaskStatusStore(
    (s) => s.byTaskId[taskId] ?? EMPTY_TASK_LIVE,
  );

  // Reconcile a stale `live=in_progress` against an authoritative
  // terminal canonical status. This handles the "WS event was missed
  // but the row is now `done`/`failed` in the DB" case at render
  // time, with no setState round-trip into the store.
  const liveStatus =
    (canonicalStatus === "done" || canonicalStatus === "failed") &&
    live.liveStatus === "in_progress"
      ? canonicalStatus
      : live.liveStatus;

  const effectiveStatus = liveStatus ?? canonicalStatus;
  const trimmedNotes =
    typeof canonicalExecutionNotes === "string"
      ? canonicalExecutionNotes.trim()
      : "";
  const failReason =
    live.liveFailReason ??
    (effectiveStatus === "failed" && trimmedNotes.length > 0
      ? trimmedNotes
      : null);

  const setLiveStatus = useCallback(
    (status: string | null) => {
      useTaskStatusStore.getState().setLiveStatus(taskId, status);
    },
    [taskId],
  );

  const setFailReason = useCallback(
    (reason: string | null) => {
      useTaskStatusStore.getState().setLiveFailReason(taskId, reason);
    },
    [taskId],
  );

  return {
    liveStatus,
    liveSessionId: live.liveSessionId,
    failReason,
    setLiveStatus,
    setFailReason,
  };
}
