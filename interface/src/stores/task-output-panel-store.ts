import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { invalidateTaskTurns } from "./task-turn-cache";
import { removePersistedTaskOutputText } from "./event-store/task-output-cache";

const STORAGE_KEY = "aura-task-output-panel";
const TASKS_STORAGE_KEY = "aura-task-output-panel-tasks";
const DEFAULT_HEIGHT = 200;
const MIN_HEIGHT = 80;
const MAX_HEIGHT = 500;
const MAX_PERSISTED_TASKS = 20;
const PERSIST_DEBOUNCE_MS = 150;

export type PanelTaskStatus = "active" | "completed" | "failed" | "interrupted";
export type OutputPanelTab = "run" | "terminal";

export interface PanelTaskEntry {
  taskId: string;
  title: string;
  status: PanelTaskStatus;
  projectId: string;
  agentInstanceId?: string;
  updatedAt: number;
}

function loadPanelState(): { height: number; collapsed: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { height: DEFAULT_HEIGHT, collapsed: false };
}

function savePanelState(height: number, collapsed: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ height, collapsed }));
  } catch { /* ignore */ }
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
      return parsed.filter((t) => t.taskId && t.projectId);
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

function schedulePersist(height: number, collapsed: boolean, tasks: PanelTaskEntry[]) {
  if (persistTimer != null) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    savePanelState(height, collapsed);
    savePersistedTasks(tasks);
    persistTimer = null;
  }, PERSIST_DEBOUNCE_MS);
}

interface TaskOutputPanelState {
  panelHeight: number;
  collapsed: boolean;
  activeTab: OutputPanelTab;
  tasks: PanelTaskEntry[];

  setActiveTab: (tab: OutputPanelTab) => void;
  toggleCollapse: () => void;
  addTask: (taskId: string, projectId: string, title?: string, agentInstanceId?: string) => void;
  completeTask: (taskId: string) => void;
  failTask: (taskId: string) => void;
  dismissTask: (taskId: string) => void;
  clearCompleted: () => void;
  markAllCompleted: () => void;
  restoreTasks: (entries: PanelTaskEntry[]) => void;
  /**
   * Apply authoritative per-task statuses (e.g. from `GET /projects/:pid/tasks`
   * on project load). Used to resolve "active" rehydrated entries whose real
   * status has moved on while the UI was closed. Entries not present in
   * `updates` are left untouched so live in-progress runs continue to tick.
   */
  reconcileStatuses: (updates: Array<{ taskId: string; status: PanelTaskStatus }>) => void;
  handleMouseDown: (e: React.MouseEvent) => void;
}

const saved = loadPanelState();
const restoredTasks = loadPersistedTasks();

export const useTaskOutputPanelStore = create<TaskOutputPanelState>()((set, get) => ({
  panelHeight: saved.height,
  collapsed: saved.collapsed,
  activeTab: "run" as OutputPanelTab,
  tasks: restoredTasks,

  setActiveTab: (tab) => {
    set({ activeTab: tab });
  },

  toggleCollapse: () => {
    set((s) => ({ collapsed: !s.collapsed }));
  },

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

  completeTask: (taskId) => {
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.taskId === taskId ? { ...t, status: "completed" as const, updatedAt: Date.now() } : t,
      ),
    }));
  },

  failTask: (taskId) => {
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.taskId === taskId ? { ...t, status: "failed" as const, updatedAt: Date.now() } : t,
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

  restoreTasks: (entries) => {
    set((s) => {
      const existingIds = new Set(s.tasks.map((t) => t.taskId));
      const newEntries = entries.filter((e) => !existingIds.has(e.taskId));
      return { tasks: [...s.tasks, ...newEntries] };
    });
  },

  reconcileStatuses: (updates) => {
    if (updates.length === 0) return;
    const updateMap = new Map(updates.map((u) => [u.taskId, u.status]));
    set((s) => {
      let changed = false;
      const nextTasks = s.tasks.map((t) => {
        const nextStatus = updateMap.get(t.taskId);
        if (!nextStatus || nextStatus === t.status) return t;
        changed = true;
        return { ...t, status: nextStatus, updatedAt: Date.now() };
      });
      return changed ? { tasks: nextTasks } : s;
    });
  },

  handleMouseDown: (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = get().panelHeight;

    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight + delta));
      set({ panelHeight: newHeight });
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  },
}));

useTaskOutputPanelStore.subscribe((state, prevState) => {
  if (
    state.panelHeight === prevState.panelHeight &&
    state.collapsed === prevState.collapsed &&
    state.tasks === prevState.tasks
  ) {
    return;
  }
  schedulePersist(state.panelHeight, state.collapsed, state.tasks);
});

export function useTasksForProject(projectId: string | undefined, agentInstanceId?: string | undefined) {
  return useTaskOutputPanelStore(
    useShallow((s) => {
      let list = projectId ? s.tasks.filter((t) => t.projectId === projectId) : s.tasks;
      if (agentInstanceId) list = list.filter((t) => t.agentInstanceId === agentInstanceId);
      return list;
    }),
  );
}
