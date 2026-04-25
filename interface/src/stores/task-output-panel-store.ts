import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { invalidateTaskTurns } from "./task-turn-cache";
import { removePersistedTaskOutputText } from "./event-store/task-output-cache";

const TASKS_STORAGE_KEY = "aura-task-output-panel-tasks";
const MAX_PERSISTED_TASKS = 20;
const PERSIST_DEBOUNCE_MS = 150;

export type PanelTaskStatus = "active" | "completed" | "failed" | "interrupted";

export interface PanelTaskEntry {
  taskId: string;
  title: string;
  status: PanelTaskStatus;
  projectId: string;
  agentInstanceId?: string;
  updatedAt: number;
  /**
   * Human-readable reason the task failed. Populated from either the
   * `task_failed` event's `reason` field (live path) or the persisted
   * `tasks.execution_notes` column surfaced through `reconcileStatuses`
   * (reload path). Displayed in the sidekick Run pane so users can tell
   * a completion-gate rejection apart from a real crash.
   */
  failureReason?: string;
}

function loadPersistedTasks(): PanelTaskEntry[] {
  try {
    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PanelTaskEntry[];
      // Keep previously-active rows marked "active" on boot. A project-
      // layout-level reconciliation (`reconcileStatuses`) promotes them
      // to the authoritative server status once `/tasks` has loaded.
      // The old behaviour ("demote everything to interrupted") flashed
      // stale "Interrupted" badges on rows that the server still
      // considered in-progress, and left genuinely-done rows showing
      // "Interrupted" forever when the server never reported a final
      // status through the panel (e.g. because the task completed
      // while the UI was closed).
      return parsed
        .filter((t) => t.taskId && t.projectId)
        .map((t) => ({
          ...t,
          failureReason:
            typeof t.failureReason === "string" && t.failureReason.length > 0
              ? t.failureReason
              : undefined,
        }));
    }
  } catch { /* ignore */ }
  return [];
}

function savePersistedTasks(tasks: PanelTaskEntry[]) {
  try {
    const trimmed = tasks.slice(-MAX_PERSISTED_TASKS);
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(trimmed));
  } catch { /* ignore */ }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(tasks: PanelTaskEntry[]) {
  if (persistTimer != null) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    savePersistedTasks(tasks);
    persistTimer = null;
  }, PERSIST_DEBOUNCE_MS);
}

interface TaskOutputPanelState {
  tasks: PanelTaskEntry[];

  addTask: (taskId: string, projectId: string, title?: string, agentInstanceId?: string) => void;
  /**
   * Rehydrate an "active" row for a task the server says is currently
   * streaming (from `GET /loop/status` → `active_tasks`). Used on page
   * refresh / WS reconnect so the Run panel doesn't silently drop rows
   * whose `task_started` events were missed because they fired before
   * the new session connected. Safe to call repeatedly: an existing
   * row for the same task is promoted back to "active" (and its
   * `agentInstanceId` is filled in if it was missing), while rows we
   * already know about are not re-created.
   */
  hydrateActiveTask: (taskId: string, projectId: string, agentInstanceId?: string) => void;
  completeTask: (taskId: string) => void;
  /**
   * Mark a task as failed. When `reason` is a non-empty string it is
   * stored on the entry and survives localStorage persistence. Passing
   * `null` / `undefined` leaves any previously-captured reason
   * untouched, so a synthetic `task_failed` with no reason field can't
   * wipe out a reason an earlier event already recorded.
   */
  failTask: (taskId: string, reason?: string | null) => void;
  dismissTask: (taskId: string) => void;
  clearCompleted: () => void;
  /**
   * Mark every `"active"` task as `"completed"` regardless of project.
   * Retained for tests and emergency reset paths only — production
   * callers should use `markCompletedForProject` so a `LoopStopped`
   * in project A doesn't wipe project B's live rows.
   */
  markAllCompleted: () => void;
  /**
   * Mark only the `"active"` rows that belong to `projectId` (and, if
   * `agentInstanceId` is provided, also match that instance) as
   * `"completed"`. This is what the `LoopStopped` / `LoopFinished`
   * handler should use so cross-project Run panels stay correct when a
   * loop ends in only one of them.
   */
  markCompletedForProject: (projectId: string, agentInstanceId?: string) => void;
  restoreTasks: (entries: PanelTaskEntry[]) => void;
  /**
   * Apply authoritative per-task statuses (e.g. from `GET /projects/:pid/tasks`
   * on project load). Used to resolve "active" rehydrated entries whose real
   * status has moved on while the UI was closed. Entries not present in
   * `updates` are left untouched so live in-progress runs continue to tick.
   * When `title` is provided and differs from a placeholder (e.g. the raw
   * task id left behind by `hydrateActiveTask`), the row's title is updated
   * too so rehydrated rows show a proper label once `listTasks` arrives.
   */
  reconcileStatuses: (
    updates: Array<{
      taskId: string;
      status: PanelTaskStatus;
      title?: string;
      /**
       * `tasks.execution_notes` from the server. Only consumed when the
       * reconciled status is `"failed"` and the panel entry doesn't
       * already have a `failureReason` (so a live `task_failed` reason
       * that arrived over the WS wins over a stale DB value).
       */
      executionNotes?: string | null;
    }>,
  ) => void;
  /**
   * Demote any `"active"` row for `projectId` whose `taskId` is NOT in
   * `keepTaskIds` to `"interrupted"`. Used at `/loop/status` hydration
   * points (boot, WS reconnect, `/loop/start`, `/loop/resume`) so a
   * stale row from a stopped / refreshed prior run can't linger next to
   * the new run's row and render a duplicate cooking indicator. A later
   * `reconcileStatuses` pass will promote the row to `completed` /
   * `failed` once `/projects/:pid/tasks` reports the true terminal
   * status, so `"interrupted"` is only a transient holding state.
   */
  demoteStaleActive: (projectId: string, keepTaskIds: string[]) => void;
}

const restoredTasks = loadPersistedTasks();

export const useTaskOutputPanelStore = create<TaskOutputPanelState>()((set, get) => ({
  tasks: restoredTasks,

  addTask: (taskId, projectId, title, agentInstanceId) => {
    set((s) => {
      const existing = s.tasks.find((t) => t.taskId === taskId);
      if (existing && existing.status === "active") return s;
      const entry: PanelTaskEntry = {
        taskId,
        title: title || existing?.title || taskId,
        status: "active",
        projectId,
        agentInstanceId: agentInstanceId || existing?.agentInstanceId,
        updatedAt: Date.now(),
      };
      const filtered = s.tasks.filter((t) => t.taskId !== taskId);
      return { tasks: [...filtered, entry] };
    });
  },

  hydrateActiveTask: (taskId, projectId, agentInstanceId) => {
    set((s) => {
      const existing = s.tasks.find((t) => t.taskId === taskId);
      if (existing) {
        const nextAgent = existing.agentInstanceId ?? agentInstanceId;
        if (existing.status === "active" && existing.agentInstanceId === nextAgent) {
          return s;
        }
        return {
          tasks: s.tasks.map((t) =>
            t.taskId === taskId
              ? {
                  ...t,
                  status: "active" as const,
                  agentInstanceId: nextAgent,
                  updatedAt: Date.now(),
                }
              : t,
          ),
        };
      }
      const entry: PanelTaskEntry = {
        taskId,
        title: taskId,
        status: "active",
        projectId,
        agentInstanceId,
        updatedAt: Date.now(),
      };
      return { tasks: [...s.tasks, entry] };
    });
  },

  completeTask: (taskId) => {
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.taskId === taskId ? { ...t, status: "completed" as const, updatedAt: Date.now() } : t,
      ),
    }));
  },

  failTask: (taskId, reason) => {
    const trimmed =
      typeof reason === "string" && reason.trim().length > 0
        ? reason.trim()
        : null;
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.taskId === taskId
          ? {
              ...t,
              status: "failed" as const,
              updatedAt: Date.now(),
              failureReason: trimmed ?? t.failureReason,
            }
          : t,
      ),
    }));
  },

  dismissTask: (taskId) => {
    set((s) => ({ tasks: s.tasks.filter((t) => t.taskId !== taskId) }));
    // Dropping a row from the panel is an explicit "I don't want to
    // see this again" signal, so we also purge the structured turn
    // cache and any orphaned text snapshot for that task.
    invalidateTaskTurns(taskId);
    removePersistedTaskOutputText(taskId);
  },

  clearCompleted: () => {
    const removed = get().tasks.filter((t) => t.status !== "active");
    set((s) => ({ tasks: s.tasks.filter((t) => t.status === "active") }));
    for (const t of removed) {
      invalidateTaskTurns(t.taskId);
      removePersistedTaskOutputText(t.taskId);
    }
  },

  markAllCompleted: () => {
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.status === "active" ? { ...t, status: "completed" as const, updatedAt: Date.now() } : t,
      ),
    }));
  },

  markCompletedForProject: (projectId, agentInstanceId) => {
    set((s) => {
      let changed = false;
      const nextTasks = s.tasks.map((t) => {
        if (t.status !== "active") return t;
        if (t.projectId !== projectId) return t;
        if (agentInstanceId && t.agentInstanceId !== agentInstanceId) return t;
        changed = true;
        return { ...t, status: "completed" as const, updatedAt: Date.now() };
      });
      return changed ? { tasks: nextTasks } : s;
    });
  },

  restoreTasks: (entries) => {
    set((s) => {
      const existingIds = new Set(s.tasks.map((t) => t.taskId));
      const newEntries = entries.filter((e) => !existingIds.has(e.taskId));
      return { tasks: [...s.tasks, ...newEntries] };
    });
  },

  demoteStaleActive: (projectId, keepTaskIds) => {
    const keep = new Set(keepTaskIds);
    set((s) => {
      let changed = false;
      const nextTasks = s.tasks.map((t) => {
        if (t.projectId !== projectId) return t;
        if (t.status !== "active") return t;
        if (keep.has(t.taskId)) return t;
        changed = true;
        return { ...t, status: "interrupted" as const, updatedAt: Date.now() };
      });
      return changed ? { tasks: nextTasks } : s;
    });
  },

  reconcileStatuses: (updates) => {
    if (updates.length === 0) return;
    const updateMap = new Map(
      updates.map(
        (u) =>
          [
            u.taskId,
            { status: u.status, title: u.title, executionNotes: u.executionNotes },
          ] as const,
      ),
    );
    set((s) => {
      let changed = false;
      const nextTasks = s.tasks.map((t) => {
        const update = updateMap.get(t.taskId);
        if (!update) return t;
        const nextTitle =
          update.title && update.title !== t.title && t.title === t.taskId
            ? update.title
            : t.title;
        const statusChanged = update.status !== t.status;
        const titleChanged = nextTitle !== t.title;
        // Reload-safe path: if the server says this task ended in
        // `failed` and carries a non-empty `execution_notes`, copy it
        // onto the panel entry — but only if we don't already have a
        // live `failureReason` from the WS (which is fresher than DB).
        const trimmedNotes =
          typeof update.executionNotes === "string" &&
          update.executionNotes.trim().length > 0
            ? update.executionNotes.trim()
            : null;
        const nextFailureReason =
          update.status === "failed" && trimmedNotes && !t.failureReason
            ? trimmedNotes
            : t.failureReason;
        const failureReasonChanged = nextFailureReason !== t.failureReason;
        if (!statusChanged && !titleChanged && !failureReasonChanged) return t;
        changed = true;
        return {
          ...t,
          status: update.status,
          title: nextTitle,
          updatedAt: Date.now(),
          failureReason: nextFailureReason,
        };
      });
      return changed ? { tasks: nextTasks } : s;
    });
  },
}));

useTaskOutputPanelStore.subscribe((state, prevState) => {
  if (state.tasks === prevState.tasks) return;
  schedulePersist(state.tasks);
});

// One-time cleanup: earlier builds persisted the bottom panel's height
// and collapsed flag under this key. The bottom panel has been
// removed, so drop the stale entry on first load to keep localStorage
// tidy. Safe to keep for a few releases.
try {
  localStorage.removeItem("aura-task-output-panel");
} catch { /* ignore */ }

export function useTasksForProject(projectId: string | undefined, agentInstanceId?: string | undefined) {
  return useTaskOutputPanelStore(
    useShallow((s) => {
      let list = projectId ? s.tasks.filter((t) => t.projectId === projectId) : s.tasks;
      if (agentInstanceId) list = list.filter((t) => t.agentInstanceId === agentInstanceId);
      return list;
    }),
  );
}
