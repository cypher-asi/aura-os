import { create } from "zustand";

/* ------------------------------------------------------------------ */
/*  Per-task live status store                                         */
/*                                                                     */
/*  Single source of truth for the "live" view of any task's status,   */
/*  session id, and failure reason as reported by streaming WS         */
/*  events. Populated app-wide by the handlers registered in           */
/*  `task-stream-bootstrap.ts` (`TaskStarted` / `TaskCompleted` /      */
/*  `TaskFailed`), so multiple components observing the same task      */
/*  share the same value rather than each holding its own React        */
/*  state and racing each other on first render.                       */
/*                                                                     */
/*  Why this exists (and why it isn't merged with                      */
/*  `useTaskOutputPanelStore`):                                        */
/*    - The panel store models *which tasks the user has opened in     */
/*      the Run panel* — a UI surface that the sidekick preview does   */
/*      not always reflect (e.g. previewing a task that was never      */
/*      added to the panel).                                           */
/*    - This store models *the live status of any task by id*,         */
/*      regardless of whether the panel knows about it. Components     */
/*      like `TaskPreview` and `RunTaskButton` use it to decide        */
/*      whether to show "in progress" / "completed" / "failed" UI      */
/*      and to seed the optimistic "ready" reset on retry.             */
/*                                                                     */
/*  Reads happen through the thin `useTaskStatus` hook, which adds     */
/*  per-render reconciliation against the canonical DB status         */
/*  (handles "WS event was missed but the row is now `done` in the     */
/*  DB") and derives the user-facing `failReason` from either          */
/*  `liveFailReason` or the persisted `tasks.execution_notes`.         */
/* ------------------------------------------------------------------ */

export interface TaskLiveStatus {
  /**
   * Last status emitted by a WS lifecycle event for this task.
   * `null` when no event has fired yet (page just loaded, or the
   * task has never streamed in this session).
   */
  liveStatus: string | null;
  /**
   * Session id captured from the `TaskStarted` event. Used by the
   * preview "View session" affordance so we can deep-link into the
   * agent's chat history without re-querying the API.
   */
  liveSessionId: string | null;
  /**
   * Failure reason captured from a live `TaskFailed` event. Distinct
   * from the persisted `tasks.execution_notes` column on the canonical
   * task row — when both are present the live reason wins, but the
   * persisted notes are used as a reload-safe fallback by
   * `useTaskStatus`.
   */
  liveFailReason: string | null;
}

export const EMPTY_TASK_LIVE: TaskLiveStatus = {
  liveStatus: null,
  liveSessionId: null,
  liveFailReason: null,
};

interface TaskStatusState {
  byTaskId: Record<string, TaskLiveStatus>;

  setLiveStatus: (taskId: string, status: string | null) => void;
  setLiveSessionId: (taskId: string, sessionId: string | null) => void;
  setLiveFailReason: (taskId: string, reason: string | null) => void;

  /**
   * Drop the live state for a single task. Used by tests; production
   * code shouldn't need this because the WS lifecycle handlers
   * overwrite stale entries naturally.
   */
  clearTask: (taskId: string) => void;

  /** Test-only: reset the entire store. */
  reset: () => void;
}

function patch(
  s: TaskStatusState,
  taskId: string,
  patch: Partial<TaskLiveStatus>,
): TaskStatusState | Pick<TaskStatusState, "byTaskId"> {
  const prev = s.byTaskId[taskId] ?? EMPTY_TASK_LIVE;
  let changed = false;
  for (const k of Object.keys(patch) as Array<keyof TaskLiveStatus>) {
    if (prev[k] !== patch[k]) {
      changed = true;
      break;
    }
  }
  if (!changed) return s;
  return {
    byTaskId: {
      ...s.byTaskId,
      [taskId]: { ...prev, ...patch },
    },
  };
}

export const useTaskStatusStore = create<TaskStatusState>()((set) => ({
  byTaskId: {},

  setLiveStatus: (taskId, status) =>
    set((s) => patch(s, taskId, { liveStatus: status })),

  setLiveSessionId: (taskId, sessionId) =>
    set((s) => patch(s, taskId, { liveSessionId: sessionId })),

  setLiveFailReason: (taskId, reason) =>
    set((s) => patch(s, taskId, { liveFailReason: reason })),

  clearTask: (taskId) =>
    set((s) => {
      if (!(taskId in s.byTaskId)) return s;
      const next = { ...s.byTaskId };
      delete next[taskId];
      return { byTaskId: next };
    }),

  reset: () => set({ byTaskId: {} }),
}));

/**
 * Imperative read helper for code paths that can't use the React
 * hook (e.g. the WS bootstrap or one-off callbacks). Returns the
 * shared `EMPTY_TASK_LIVE` singleton when the task has no entry,
 * so callers can destructure without null checks.
 */
export function getTaskLiveStatus(taskId: string): TaskLiveStatus {
  return useTaskStatusStore.getState().byTaskId[taskId] ?? EMPTY_TASK_LIVE;
}
