import { useEffect, useState, useMemo } from "react";
import type { ProjectId, Task } from "../../types";
import { EventType } from "../../types/aura-events";
import { api } from "../../api/client";
import { useEventStore } from "../../stores/event-store";
import { useLoopActive } from "../../hooks/use-loop-active";
import { titleSortKey } from "../../utils/collections";

const STATUS_ORDER: Record<string, number> = {
  in_progress: 0, ready: 1, pending: 2, blocked: 3, done: 4, failed: 5,
};

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const statusDiff = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
    if (statusDiff !== 0) return statusDiff;
    const ka = titleSortKey(a.title);
    const kb = titleSortKey(b.title);
    if (ka !== kb) return ka - kb;
    return a.order_index - b.order_index;
  });
}

interface TaskFeedData {
  tasks: Task[];
  sorted: Task[];
  activeTaskId: string | null;
  loopActive: boolean;
}

export function useTaskFeedData(projectId: ProjectId): TaskFeedData {
  const subscribe = useEventStore((s) => s.subscribe);
  const loopActive = useLoopActive(projectId);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  useEffect(() => {
    api.listTasks(projectId).then(setTasks).catch(console.error);
    const interval = setInterval(() => {
      api.listTasks(projectId).then(setTasks).catch(console.error);
    }, 15000);
    return () => clearInterval(interval);
  }, [projectId]);

  useEffect(() => {
    const refetch = () => api.listTasks(projectId).then(setTasks).catch(console.error);
    const setStatus = (taskId: string, status: Task["status"]) =>
      setTasks((prev) => prev.map((t) => (t.task_id === taskId ? { ...t, status } : t)));

    const unsubs = [
      subscribe(EventType.TaskStarted, (e) => {
        setActiveTaskId(e.content.task_id || null);
        if (e.content.task_id) setStatus(e.content.task_id, "in_progress");
      }),
      subscribe(EventType.TaskCompleted, (e) => {
        setActiveTaskId((curr) => (curr === e.content.task_id ? null : curr));
        if (e.content.task_id) setStatus(e.content.task_id, "done");
      }),
      subscribe(EventType.TaskFailed, (e) => {
        setActiveTaskId((curr) => (curr === e.content.task_id ? null : curr));
        if (e.content.task_id) setStatus(e.content.task_id, "failed");
      }),
      subscribe(EventType.TaskBecameReady, (e) => {
        if (e.content.task_id) setStatus(e.content.task_id, "ready");
      }),
      subscribe(EventType.TasksBecameReady, (e) => {
        if (!e.content.task_ids?.length) return;
        const readySet = new Set(e.content.task_ids);
        setTasks((prev) => prev.map((t) => readySet.has(t.task_id) ? { ...t, status: "ready" as const } : t));
      }),
      subscribe(EventType.FollowUpTaskCreated, (e) => { if (e.content.task_id) refetch(); }),
      subscribe(EventType.LoopStopped, () => { setActiveTaskId(null); refetch(); }),
      subscribe(EventType.LoopPaused, () => { setActiveTaskId(null); refetch(); }),
      subscribe(EventType.LoopFinished, () => { setActiveTaskId(null); refetch(); }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, projectId]);

  const sorted = useMemo(() => sortTasks(tasks), [tasks]);

  return { tasks, sorted, activeTaskId, loopActive };
}
