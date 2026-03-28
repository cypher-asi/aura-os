import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { api } from "../../api/client";
import type { Spec, Task, TaskStatus } from "../../types";
import { EventType } from "../../types/aura-events";
import { useProjectContext } from "../../stores/project-action-store";
import { useEventStore } from "../../stores/event-store";
import { useSidekick } from "../../stores/sidekick-store";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useLoopActive } from "../../hooks/use-loop-active";
import { mergeById, compareSpecs } from "../../utils/collections";

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

  const streamingId = useSidekickStore((s) => s.streamingAgentInstanceId);
  const prevStreamIdRef = useRef<string | null>(null);

  useEffect(() => {
    const wasStreaming = prevStreamIdRef.current != null;
    prevStreamIdRef.current = streamingId;
    if (wasStreaming && streamingId == null) {
      refetchTasks();
    }
  }, [streamingId, refetchTasks]);

  useEffect(() => {
    const unsubs = [
      subscribe(EventType.TaskStarted, (e) => {
        const { task_id } = e.content;
        if (task_id) {
          setLiveTaskIds((prev) => new Set(prev).add(task_id));
          updateTaskStatus(task_id, "in_progress", {
            ...(e.session_id ? { session_id: e.session_id } : {}),
          });
        }
      }),
      subscribe(EventType.TaskCompleted, (e) => {
        const { task_id, execution_notes, files } = e.content;
        if (task_id) {
          setLiveTaskIds((prev) => { const next = new Set(prev); next.delete(task_id); return next; });
          updateTaskStatus(task_id, "done", {
            execution_notes,
            ...(files ? { files_changed: files } : {}),
          });
        }
      }),
      subscribe(EventType.TaskFailed, (e) => {
        const { task_id } = e.content;
        if (task_id) {
          setLiveTaskIds((prev) => { const next = new Set(prev); next.delete(task_id); return next; });
          updateTaskStatus(task_id, "failed");
        }
      }),
      subscribe(EventType.FileOpsApplied, (e) => {
        const { task_id, files } = e.content;
        if (!task_id || !files) return;
        setLocalTasks((prev) => {
          const task = prev.find((t) => t.task_id === task_id);
          if (!task) return prev;
          const patch: Partial<Task> = { files_changed: files };
          if (task.status !== "done" && task.status !== "failed") {
            (patch as Record<string, unknown>).status = "in_progress";
          }
          return prev.map((t) => (t.task_id === task_id ? { ...t, ...patch } : t));
        });
        sidekickRef.current.patchTask(task_id, { files_changed: files } as Partial<Task>);
      }),
      subscribe(EventType.TaskBecameReady, (e) => { if (e.content.task_id) updateTaskStatus(e.content.task_id, "ready"); }),
      subscribe(EventType.TasksBecameReady, (e) => {
        if (!e.content.task_ids?.length) return;
        setLocalTasks((prev) => {
          const readySet = new Set(e.content.task_ids);
          return prev.map((t) => readySet.has(t.task_id) ? { ...t, status: "ready" as const } : t);
        });
      }),
      subscribe(EventType.FollowUpTaskCreated, refetchTasks),
      subscribe(EventType.LoopStopped, () => { setLiveTaskIds(new Set()); refetchTasks(); }),
      subscribe(EventType.LoopPaused, () => { setLiveTaskIds(new Set()); refetchTasks(); }),
      subscribe(EventType.LoopFinished, () => { setLiveTaskIds(new Set()); refetchTasks(); }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, updateTaskStatus, refetchTasks]);

  const specs = useMemo(() => mergeById(sidekick.specs, localSpecs, "spec_id").sort(compareSpecs), [localSpecs, sidekick.specs]);
  const tasks = useMemo(() => mergeById(sidekick.tasks, localTasks, "task_id"), [localTasks, sidekick.tasks]);

  return { specs, tasks, liveTaskIds, loopActive, loading, sidekick };
}
