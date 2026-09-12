import { useEffect, useState, useMemo } from "react";
import { api } from "../../api/client";
import type { Task } from "../../shared/types";
import { EventType } from "../../shared/types/aura-events";
import { useProjectActions } from "../../stores/project-action-store";
import { useEventStore } from "../../stores/event-store/index";
import { useLiveTaskIdsForProject } from "../../stores/live-task-ids-store";
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

interface TaskSnapshot {
  projectId: string;
  fetched: Task[] | null;
  initialRevision?: string;
  saved: Map<string, Task>;
  statuses: Map<string, Task["status"]>;
}

function emptySnapshot(projectId: string): TaskSnapshot {
  return { projectId, fetched: null, saved: new Map(), statuses: new Map() };
}

export function useMobileTasks(projectId: string): MobileTasksData {
  const ctx = useProjectActions();
  const subscribe = useEventStore((s) => s.subscribe);
  const loopActive = useLoopActive(projectId);
  const [snapshot, setSnapshot] = useState<TaskSnapshot>(() => emptySnapshot(projectId));
  const initialTasks = ctx?.project.project_id === projectId ? ctx.initialTasks : undefined;
  // Compare content, not array identity: reconstructed but equivalent inputs
  // must not restart the fetch, while a real project-data refresh must win.
  const initialRevision = useMemo(() => JSON.stringify(initialTasks ?? []), [initialTasks]);
  // Derive the initial list instead of copying it into state in an effect.
  // Callers may supply a fresh array on every render. Live events are kept
  // separately so a slower initial fetch cannot overwrite newer updates.
  const tasks = useMemo(() => {
    const current = snapshot.projectId === projectId ? snapshot : emptySnapshot(projectId);
    const base = current.initialRevision === initialRevision ? current.fetched : null;
    const byId = new Map((base ?? initialTasks ?? []).map((task) => [task.task_id, task]));
    for (const [id, task] of current.saved) byId.set(id, task);
    return sortByOrder(Array.from(byId.values(), (task) => {
      const status = current.statuses.get(task.task_id);
      return status ? { ...task, status } : task;
    }));
  }, [initialRevision, initialTasks, projectId, snapshot]);
  // Single source of truth for "is this task live": derived from
  // `useLoopActivityStore` via `useLiveTaskIdsForProject`. The
  // previous design kept a parallel cache here that this hook
  // mirrored from `task_started` etc., which let the cache lag the
  // `LoopActivityChanged` pipeline and produce a hollow per-row
  // spinner during an active run. See the doc-comment in
  // `live-task-ids-store.ts` for the full migration table.
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
    let cancelled = false;
    void api.listTasks(projectId).then((nextTasks) => {
      if (!cancelled) setSnapshot((previous) => ({
        ...(previous.projectId === projectId ? previous : emptySnapshot(projectId)),
        fetched: nextTasks,
        initialRevision,
      }));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [initialRevision, projectId]);

  useEffect(() => {
    const setStatus = (taskId: string, status: Task["status"]) =>
      setSnapshot((previous) => {
        const current = previous.projectId === projectId ? previous : emptySnapshot(projectId);
        return { ...current, statuses: new Map(current.statuses).set(taskId, status) };
      });

    const unsubs = [
      subscribe(EventType.TaskSaved, (e) => {
        const task = e.content.task;
        if (e.project_id !== projectId || !task) return;
        setSnapshot((previous) => {
          const current = previous.projectId === projectId ? previous : emptySnapshot(projectId);
          const statuses = new Map(current.statuses);
          statuses.delete(task.task_id);
          return { ...current, saved: new Map(current.saved).set(task.task_id, task), statuses };
        });
      }),
      subscribe(EventType.TaskStarted, (e) => {
        if (e.project_id !== projectId) return;
        if (e.content.task_id) setStatus(e.content.task_id, "in_progress");
      }),
      subscribe(EventType.TaskCompleted, (e) => {
        if (e.project_id !== projectId) return;
        if (e.content.task_id) setStatus(e.content.task_id, "done");
      }),
      subscribe(EventType.TaskFailed, (e) => {
        if (e.project_id !== projectId) return;
        if (e.content.task_id) setStatus(e.content.task_id, "failed");
      }),
      // No `LoopStopped` / `LoopFinished` clear-the-cache subscribers
      // here: the live-task-ids signal now derives from
      // `useLoopActivityStore`, which clears itself when
      // `LoopActivityChanged` flips `current_task_id` to `None` or
      // `LoopEnded` removes the row entirely.
    ];
    return () => unsubs.forEach((u) => u());
  }, [projectId, subscribe]);

  return { tasks, tasksBySpec, liveTaskIds, loopActive };
}
