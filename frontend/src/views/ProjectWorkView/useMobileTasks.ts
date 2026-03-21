import { useEffect, useState, useMemo } from "react";
import { api } from "../../api/client";
import type { Task } from "../../types";
import { useProjectContext } from "../../stores/project-action-store";

function sortByOrder<T extends { order_index: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.order_index - right.order_index);
}

interface MobileTasksData {
  tasks: Task[];
  tasksBySpec: Map<string, Task[]>;
}

export function useMobileTasks(projectId: string): MobileTasksData {
  const ctx = useProjectContext();
  const [tasks, setTasks] = useState<Task[]>(() => sortByOrder(ctx?.initialTasks ?? []));

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
    let cancelled = false;
    void api.listTasks(projectId).then((nextTasks) => {
      if (!cancelled) setTasks(sortByOrder(nextTasks));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

  return { tasks, tasksBySpec };
}
