import { useMemo } from "react";
import { create } from "zustand";
import type { Task, ProjectId, TaskStatus } from "../../../types";
import { tasksApi } from "../../../api/tasks";

interface ProjectTaskCache {
  tasks: Task[];
  fetchedAt: number;
}

interface KanbanState {
  tasksByProject: Record<string, ProjectTaskCache>;
  loading: Record<string, boolean>;

  fetchTasks: (projectId: ProjectId) => Promise<void>;
  addTask: (projectId: ProjectId, task: Task) => void;
  replaceTask: (projectId: ProjectId, previousTaskId: string, task: Task) => void;
  removeTask: (projectId: ProjectId, taskId: string) => void;
  patchTask: (projectId: ProjectId, taskId: string, patch: Partial<Task>) => void;
  invalidate: (projectId: ProjectId) => void;
}

const STALE_MS = 30_000;

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.order_index - b.order_index);
}

function upsertTask(tasks: Task[], task: Task): Task[] {
  const index = tasks.findIndex((candidate) => candidate.task_id === task.task_id);
  if (index === -1) return sortTasks([...tasks, task]);
  const next = [...tasks];
  next[index] = task;
  return sortTasks(next);
}

export const useKanbanStore = create<KanbanState>()((set, get) => ({
  tasksByProject: {},
  loading: {},

  fetchTasks: async (projectId) => {
    const cached = get().tasksByProject[projectId];
    if (cached && Date.now() - cached.fetchedAt < STALE_MS) return;

    set((s) => ({ loading: { ...s.loading, [projectId]: true } }));
    try {
      const tasks = await tasksApi.listTasks(projectId);
      set((s) => ({
        tasksByProject: {
          ...s.tasksByProject,
          [projectId]: { tasks: sortTasks(tasks), fetchedAt: Date.now() },
        },
        loading: { ...s.loading, [projectId]: false },
      }));
    } catch {
      set((s) => ({ loading: { ...s.loading, [projectId]: false } }));
    }
  },

  addTask: (projectId, task) => {
    set((s) => {
      const cached = s.tasksByProject[projectId];
      return {
        tasksByProject: {
          ...s.tasksByProject,
          [projectId]: {
            tasks: upsertTask(cached?.tasks ?? [], task),
            fetchedAt: cached?.fetchedAt ?? Date.now(),
          },
        },
      };
    });
  },

  replaceTask: (projectId, previousTaskId, task) => {
    set((s) => {
      const cached = s.tasksByProject[projectId];
      const nextTasks = (cached?.tasks ?? []).filter(
        (candidate) => candidate.task_id !== previousTaskId,
      );
      return {
        tasksByProject: {
          ...s.tasksByProject,
          [projectId]: {
            tasks: upsertTask(nextTasks, task),
            fetchedAt: cached?.fetchedAt ?? Date.now(),
          },
        },
      };
    });
  },

  removeTask: (projectId, taskId) => {
    set((s) => {
      const cached = s.tasksByProject[projectId];
      if (!cached) return s;
      return {
        tasksByProject: {
          ...s.tasksByProject,
          [projectId]: {
            ...cached,
            tasks: cached.tasks.filter((task) => task.task_id !== taskId),
          },
        },
      };
    });
  },

  patchTask: (projectId, taskId, patch) => {
    set((s) => {
      const cached = s.tasksByProject[projectId];
      if (!cached) return s;
      const updated = sortTasks(
        cached.tasks.map((t) =>
          t.task_id === taskId ? { ...t, ...patch } : t,
        ),
      );
      return {
        tasksByProject: {
          ...s.tasksByProject,
          [projectId]: { ...cached, tasks: updated },
        },
      };
    });
  },

  invalidate: (projectId) => {
    set((s) => {
      const copy = { ...s.tasksByProject };
      delete copy[projectId];
      return { tasksByProject: copy };
    });
  },
}));

const LANE_ORDER: TaskStatus[] = [
  "backlog",
  "to_do",
  "pending",
  "ready",
  "in_progress",
  "blocked",
  "done",
  "failed",
];

export function useKanbanLanes(
  projectId: string | undefined,
  agentInstanceId?: string,
) {
  const cached = useKanbanStore(
    (s) => (projectId ? s.tasksByProject[projectId] : undefined),
  );
  const loading = useKanbanStore(
    (s) => (projectId ? (s.loading[projectId] ?? false) : false),
  );

  const lanes = useMemo(() => {
    const empty = Object.fromEntries(
      LANE_ORDER.map((status) => [status, [] as Task[]]),
    ) as Record<TaskStatus, Task[]>;

    if (!cached) return empty;

    let tasks = cached.tasks;
    if (agentInstanceId) {
      tasks = tasks.filter(
        (t) =>
          t.assigned_agent_instance_id === agentInstanceId ||
          t.completed_by_agent_instance_id === agentInstanceId,
      );
    }

    const result = { ...empty };
    for (const task of tasks) {
      if (result[task.status]) {
        result[task.status].push(task);
      }
    }
    return result;
  }, [cached, agentInstanceId]);

  const projectTaskCount = cached?.tasks.length ?? 0;
  const filteredTaskCount = useMemo(
    () => Object.values(lanes).reduce((sum, laneTasks) => sum + laneTasks.length, 0),
    [lanes],
  );

  return { lanes, loading, filteredTaskCount, projectTaskCount };
}
