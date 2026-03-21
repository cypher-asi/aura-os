import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { api } from "../../api/client";
import type { Spec, Task, TaskStatus } from "../../types";
import { useProjectContext } from "../../stores/project-action-store";
import { useEventStore } from "../../stores/event-store";
import { useSidekick } from "../../stores/sidekick-store";
import { useLoopActive } from "../../hooks/use-loop-active";
import { mergeById } from "../../utils/collections";

interface TaskListData {
  specs: Spec[];
  tasks: Task[];
  liveTaskIds: Set<string>;
  loopActive: boolean;
  loading: boolean;
  sidekick: ReturnType<typeof useSidekick>;
}

export function useTaskListData(): TaskListData {
  const ctx = useProjectContext();
  const projectId = ctx?.project.project_id;
  const sidekick = useSidekick();
  const subscribe = useEventStore((s) => s.subscribe);
  const loopActive = useLoopActive(projectId);
  const [liveTaskIds, setLiveTaskIds] = useState<Set<string>>(() => new Set());
  const [localSpecs, setLocalSpecs] = useState<Spec[]>(() => ctx?.initialSpecs ?? []);
  const [localTasks, setLocalTasks] = useState<Task[]>(() => ctx?.initialTasks ?? []);
  const [loading] = useState(false);

  useEffect(() => { if (ctx?.initialSpecs) setLocalSpecs(ctx.initialSpecs); }, [ctx?.initialSpecs]);
  useEffect(() => { if (ctx?.initialTasks) setLocalTasks(ctx.initialTasks); }, [ctx?.initialTasks]);

  const sidekickRef = useRef(sidekick);
  sidekickRef.current = sidekick;
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const updateTaskStatus = useCallback(
    (taskId: string, newStatus: TaskStatus, extra?: Partial<Task>) => {
      setLocalTasks((prev) =>
        prev.map((t) => (t.task_id === taskId ? { ...t, ...extra, status: newStatus } : t)),
      );
      sidekickRef.current.patchTask(taskId, { ...extra, status: newStatus });
      sidekickRef.current.updatePreviewTask({ task_id: taskId, ...extra, status: newStatus });
    },
    [],
  );

  const refetchTasks = useCallback(() => {
    const pid = projectIdRef.current;
    if (!pid) return;
    api.listTasks(pid).then((t) => {
      setLocalTasks(t.sort((a, b) => a.order_index - b.order_index));
    }).catch(console.error);
  }, []);

  useEffect(() => {
    const unsubs = [
      subscribe("task_started", (e) => {
        if (e.task_id) {
          setLiveTaskIds((prev) => new Set(prev).add(e.task_id!));
          updateTaskStatus(e.task_id, "in_progress", {
            ...(e.session_id ? { session_id: e.session_id } : {}),
          });
        }
      }),
      subscribe("task_completed", (e) => {
        if (e.task_id) {
          setLiveTaskIds((prev) => { const next = new Set(prev); next.delete(e.task_id!); return next; });
          updateTaskStatus(e.task_id, "done", {
            execution_notes: e.execution_notes,
            ...(e.files ? { files_changed: e.files } : {}),
          });
        }
      }),
      subscribe("task_failed", (e) => {
        if (e.task_id) {
          setLiveTaskIds((prev) => { const next = new Set(prev); next.delete(e.task_id!); return next; });
          updateTaskStatus(e.task_id, "failed");
        }
      }),
      subscribe("file_ops_applied", (e) => {
        if (e.task_id && e.files) updateTaskStatus(e.task_id, "in_progress", { files_changed: e.files });
      }),
      subscribe("task_became_ready", (e) => { if (e.task_id) updateTaskStatus(e.task_id, "ready"); }),
      subscribe("tasks_became_ready", (e) => {
        if (!e.task_ids?.length) return;
        setLocalTasks((prev) => {
          const readySet = new Set(e.task_ids);
          return prev.map((t) => readySet.has(t.task_id) ? { ...t, status: "ready" as const } : t);
        });
      }),
      subscribe("follow_up_task_created", refetchTasks),
      subscribe("loop_stopped", refetchTasks),
      subscribe("loop_paused", refetchTasks),
      subscribe("loop_finished", refetchTasks),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, updateTaskStatus, refetchTasks]);

  const specs = useMemo(() => mergeById(sidekick.specs, localSpecs, "spec_id"), [localSpecs, sidekick.specs]);
  const tasks = useMemo(() => mergeById(sidekick.tasks, localTasks, "task_id"), [localTasks, sidekick.tasks]);

  return { specs, tasks, liveTaskIds, loopActive, loading, sidekick };
}
