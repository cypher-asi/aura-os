import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { invalidateTaskTurns } from "./task-turn-cache";
import { removePersistedTaskOutputText } from "./event-store/task-output-cache";

const TASKS_STORAGE_KEY = "aura-task-output-panel-tasks";
const MAX_PERSISTED_TASKS = 20;
const PERSIST_DEBOUNCE_MS = 150;

export type PanelTaskStatus = "active" | "completed" | "failed" | "interrupted";

/**
 * Structured provider context extracted from a `task_failed` event's
 * sibling fields (or parsed from the reason string by the server's
 * `extract_task_failure_context`). Rendered by the UI as a compact
 * `req=… · model=… · type=…` label below the failure reason so
 * operators can correlate with provider/router logs without parsing
 * the reason string.
 *
 * All fields are optional; an entry with none of them is equivalent to
 * `undefined` on the panel entry and suppresses the label entirely.
 */
export interface PanelTaskFailureContext {
  providerRequestId?: string;
  model?: string;
  sseErrorType?: string;
  messageId?: string;
}

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
  /**
   * Structured provider context. See {@link PanelTaskFailureContext}.
   * Only populated on the live WS path (today); reload path leaves it
   * undefined because the server persists only the reason string into
   * `execution_notes` — future work could restore it from a structured
   * column.
   */
  failureContext?: PanelTaskFailureContext;
}

/**
 * Normalise a {@link PanelTaskFailureContext} candidate from either a
 * live `failTask` call or a restored localStorage blob:
 *   - trim strings
 *   - drop empty strings
 *   - return `undefined` when no field is populated (keeps the entry
 *     shape minimal so rows without provider context don't trip the
 *     "render the label" check below)
 */
function sanitizeFailureContext(
  ctx: PanelTaskFailureContext | undefined | null,
): PanelTaskFailureContext | undefined {
  if (!ctx) return undefined;
  const pick = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
  const next: PanelTaskFailureContext = {
    providerRequestId: pick((ctx as PanelTaskFailureContext).providerRequestId),
    model: pick((ctx as PanelTaskFailureContext).model),
    sseErrorType: pick((ctx as PanelTaskFailureContext).sseErrorType),
    messageId: pick((ctx as PanelTaskFailureContext).messageId),
  };
  if (
    !next.providerRequestId &&
    !next.model &&
    !next.sseErrorType &&
    !next.messageId
  ) {
    return undefined;
  }
  return next;
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
          failureContext: sanitizeFailureContext(t.failureContext),
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
   *
   * `context` carries the structured provider fields forwarded by the
   * server on the `task_failed` event. Passing `undefined` leaves any
   * previously-captured context untouched; passing an object with at
   * least one populated field replaces the existing context.
   */
  failTask: (
    taskId: string,
    reason?: string | null,
    context?: PanelTaskFailureContext,
  ) => void;
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
   *
   * When `options.seedProjectId` is supplied, updates whose `taskId` is
   * not yet in the store are *inserted* as new panel entries scoped to
   * that project — but only when the resolved status represents an
   * actual run (`"active"` / `"completed"` / `"failed"`). This is what
   * lets the Run pane populate from the authoritative server task list
   * on a fresh boot (or after the user cleared site data) without
   * waiting for a future `task_started` event. Statuses that map to
   * `"interrupted"` (backlog / to_do / pending / ready / blocked) are
   * skipped so the panel doesn't fill up with rows the user never ran.
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
      /**
       * Optional millisecond timestamp used as the seeded entry's
       * `updatedAt` when this update inserts a new row (i.e. when
       * `options.seedProjectId` is set and the row is unknown). Lets
       * callers preserve the server's `updated_at` ordering on first
       * seed so newly-completed tasks land at the bottom of the pane.
       * Ignored when patching an existing row.
       */
      updatedAt?: number;
    }>,
    options?: { seedProjectId?: string },
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

  failTask: (taskId, reason, context) => {
    const trimmed =
      typeof reason === "string" && reason.trim().length > 0
        ? reason.trim()
        : null;
    const nextContext = sanitizeFailureContext(context);
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.taskId === taskId
          ? {
              ...t,
              status: "failed" as const,
              updatedAt: Date.now(),
              failureReason: trimmed ?? t.failureReason,
              failureContext: nextContext ?? t.failureContext,
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

  reconcileStatuses: (updates, options) => {
    if (updates.length === 0) return;
    const updateMap = new Map(
      updates.map(
        (u) =>
          [
            u.taskId,
            {
              status: u.status,
              title: u.title,
              executionNotes: u.executionNotes,
              updatedAt: u.updatedAt,
            },
          ] as const,
      ),
    );
    const seedProjectId = options?.seedProjectId;
    set((s) => {
      let changed = false;
      const existingIds = new Set(s.tasks.map((t) => t.taskId));
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
      // Seed missing entries from the server task list so the Run pane
      // populates on a cold boot (or after the user cleared site data)
      // without waiting for a future `task_started` event. We only seed
      // statuses that represent an actual run; `"interrupted"` (which
      // covers backlog / to_do / pending / ready / blocked tasks the
      // server never advanced past pending) is intentionally dropped to
      // avoid stuffing the panel with rows the user never ran.
      const seeded: PanelTaskEntry[] = [];
      if (seedProjectId) {
        for (const update of updates) {
          if (existingIds.has(update.taskId)) continue;
          if (update.status === "interrupted") continue;
          const trimmedNotes =
            typeof update.executionNotes === "string" &&
            update.executionNotes.trim().length > 0
              ? update.executionNotes.trim()
              : null;
          seeded.push({
            taskId: update.taskId,
            title: update.title || update.taskId,
            status: update.status,
            projectId: seedProjectId,
            updatedAt: update.updatedAt ?? Date.now(),
            failureReason:
              update.status === "failed" && trimmedNotes ? trimmedNotes : undefined,
          });
        }
      }
      if (seeded.length > 0) {
        seeded.sort((a, b) => a.updatedAt - b.updatedAt);
        return { tasks: [...nextTasks, ...seeded] };
      }
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
