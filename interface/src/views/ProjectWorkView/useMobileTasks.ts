import { useEffect, useState, useMemo } from "react";
import { api } from "../../api/client";
import type { Task } from "../../types";
import { EventType } from "../../types/aura-events";
import { useProjectActions } from "../../stores/project-action-store";
import { useEventStore } from "../../stores/event-store/index";
import {
  useLiveTaskIdsForProject,
  useLiveTaskIdsStore,
} from "../../stores/live-task-ids-store";
import { useLoopActive } from "../../hooks/use-loop-active";

function sortByOrder<T extends { order_index: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.order_index - right.order_index);
}

interface MobileTasksData {
  tasks: Task[];
  tasksBySpec: Map<string, Task[]>;
  liveTaskIds: Set<string>;
  loopActive: boolean;
}

export function useMobileTasks(projectId: string): MobileTasksData {
  const ctx = useProjectActions();
  const subscribe = useEventStore((s) => s.subscribe);
  const loopActive = useLoopActive(projectId);
  const [tasks, setTasks] = useState<Task[]>(() => sortByOrder(ctx?.initialTasks ?? []));
  const liveTaskIds = useLiveTaskIdsForProject(projectId);

  const tasksBySpec = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    for (const task of tasks) {
      const bucket = grouped.get(task.spec_id) ?? [];
      bucket.push(task);
      grouped.set(task.spec_id, bucket);
    }
    return grouped;
  }, [tasks]);

  useEffect(() => {
    setTasks(sortByOrder(ctx?.initialTasks ?? []));
  }, [ctx?.initialTasks]);

  useEffect(() => {
    let cancelled = false;
    void api.listTasks(projectId).then((nextTasks) => {
      if (!cancelled) setTasks(sortByOrder(nextTasks));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    const setStatus = (taskId: string, status: Task["status"]) =>
      setTasks((prev) => prev.map((t) => (t.task_id === taskId ? { ...t, status } : t)));

    const unsubs = [
      subscribe(EventType.TaskSaved, (e) => {
        const task = e.content.task;
        if (e.project_id !== projectId || !task) return;
        setTasks((prev) => sortByOrder(
          prev.some((candidate) => candidate.task_id === task.task_id)
            ? prev.map((candidate) => candidate.task_id === task.task_id ? task : candidate)
            : [...prev, task],
        ));
      }),
      subscribe(EventType.TaskStarted, (e) => {
        const { task_id } = e.content;
        if (task_id) {
          if (projectId) useLiveTaskIdsStore.getState().addLive(projectId, task_id);
          setStatus(task_id, "in_progress");
        }
      }),
      subscribe(EventType.TaskCompleted, (e) => {
        const { task_id } = e.content;
        if (task_id) {
          if (projectId) useLiveTaskIdsStore.getState().removeLive(projectId, task_id);
          setStatus(task_id, "done");
        }
      }),
      subscribe(EventType.TaskFailed, (e) => {
        const { task_id } = e.content;
        if (task_id) {
          if (projectId) useLiveTaskIdsStore.getState().removeLive(projectId, task_id);
          setStatus(task_id, "failed");
        }
      }),
      subscribe(EventType.LoopStopped, () => {
        if (projectId) useLiveTaskIdsStore.getState().clearProject(projectId);
      }),
      subscribe(EventType.LoopFinished, () => {
        if (projectId) useLiveTaskIdsStore.getState().clearProject(projectId);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [projectId, subscribe]);

  return { tasks, tasksBySpec, liveTaskIds, loopActive };
}
