import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { api } from "../../api/client";
import type { Spec, Task, TaskStatus } from "../../shared/types";
import { EventType } from "../../shared/types/aura-events";
import { useProjectActions } from "../../stores/project-action-store";
import { useEventStore } from "../../stores/event-store/index";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useLiveTaskIdsForProject } from "../../stores/live-task-ids-store";
import { useLoopActive } from "../../hooks/use-loop-active";
import { isTaskStatus } from "../../shared/utils/task-display-status";
import { mergeById, compareSpecs } from "../../utils/collections";

interface TaskListData {
  specs: Spec[];
  tasks: Task[];
  liveTaskIds: Set<string>;
  loopActive: boolean;
  loading: boolean;
}

function upsertSpec(prev: Spec[], spec: Spec): Spec[] {
  const next = prev.some((candidate) => candidate.spec_id === spec.spec_id)
    ? prev.map((candidate) => (candidate.spec_id === spec.spec_id ? spec : candidate))
    : [...prev, spec];
  return next.sort(compareSpecs);
}

function isTerminalTaskStatus(status: TaskStatus | undefined): boolean {
  return status === "done" || status === "failed";
}

// Merge an incoming task snapshot without allowing it to downgrade a task that
// the client already knows is terminal (done/failed). Storage snapshots from
// `task_saved` broadcasts or `listTasks` refetches can arrive after the client
// has already processed an authoritative `task_completed`/`task_failed` WS
// event, because the DB's status transition runs on a separate code path.
function mergeTaskPreservingTerminal(existing: Task | undefined, incoming: Task): Task {
  if (!existing) return incoming;
  if (!isTerminalTaskStatus(existing.status)) return incoming;
  if (isTerminalTaskStatus(incoming.status)) return incoming;
  return {
    ...incoming,
    status: existing.status,
    execution_notes: existing.execution_notes ?? incoming.execution_notes,
    files_changed: existing.files_changed ?? incoming.files_changed,
  };
}

function upsertTask(prev: Task[], task: Task): Task[] {
  const existing = prev.find((candidate) => candidate.task_id === task.task_id);
  const effective = mergeTaskPreservingTerminal(existing, task);
  const next = existing
    ? prev.map((candidate) => (candidate.task_id === task.task_id ? effective : candidate))
    : [...prev, effective];
  return next.sort((a, b) => a.order_index - b.order_index);
}

// Reconcile a full list of tasks from the server with the current local state,
// preserving terminal statuses the client has already observed over the WS.
// Without this guard, a `listTasks` refetch that fires between super-agent
// streaming turns (see `streamingId` effect below) would overwrite locally-done
// tasks with a stale `in_progress` snapshot whenever the DB hasn't yet been
// transitioned by the backend's `task_completed` handler.
function mergeTaskListPreservingTerminal(prev: Task[], incoming: Task[]): Task[] {
  const prevById = new Map(prev.map((t) => [t.task_id, t]));
  return incoming
    .map((t) => mergeTaskPreservingTerminal(prevById.get(t.task_id), t))
    .sort((a, b) => a.order_index - b.order_index);
}

export function useTaskListData(): TaskListData {
  const ctx = useProjectActions();
  const projectId = ctx?.project.project_id;
  const subscribe = useEventStore((s) => s.subscribe);
  const connected = useEventStore((s) => s.connected);
  const resyncNonce = useEventStore((s) => s.resyncNonce);
  const storeSpecs = useSidekickStore((s) => s.specs);
  const storeTasks = useSidekickStore((s) => s.tasks);
  const deletedSpecIds = useSidekickStore((s) => s.deletedSpecIds);
  const deletedTaskIds = useSidekickStore((s) => s.deletedTaskIds);
  const loopActive = useLoopActive(projectId);
  const liveTaskIds = useLiveTaskIdsForProject(projectId);
  const [localSpecs, setLocalSpecs] = useState<Spec[]>(() => ctx?.initialSpecs ?? []);
  const [localTasks, setLocalTasks] = useState<Task[]>(() => ctx?.initialTasks ?? []);
  const [loading] = useState(false);

  useEffect(() => { if (ctx?.initialSpecs) setLocalSpecs(ctx.initialSpecs); }, [ctx?.initialSpecs]);
  useEffect(() => {
    if (!ctx?.initialTasks) return;
    setLocalTasks((prev) => mergeTaskListPreservingTerminal(prev, ctx.initialTasks));
  }, [ctx?.initialTasks]);

  const sidekickRef = useRef(useSidekickStore.getState());
  useEffect(() => useSidekickStore.subscribe((s) => { sidekickRef.current = s; }), []);
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
      setLocalTasks((prev) => mergeTaskListPreservingTerminal(prev, t));
      sidekickRef.current.clearDeletedTasks();
    }).catch(console.error);
  }, []);

  const streamingId = useSidekickStore((s) => s.streamingAgentInstanceId);
  const prevStreamIdRef = useRef<string | null>(null);
  const prevConnectedRef = useRef(connected);

  // The "is this task live" set used to live in a parallel
  // `useLiveTaskIdsStore` that this hook manually mirrored from
  // `task_started` / `task_completed` / `task_failed` events plus a
  // `/loop/status` poll. That parallel cache was the original source
  // of the per-row spinner regression: the harness
  // `LoopActivityChanged` pipeline (which we now treat as the single
  // source of truth) could be ahead of, behind, or out of sync with
  // the local cache, and a stale cache would render a hollow circle
  // for an actively-running task. The store is now a pure derived
  // view over `useLoopActivityStore`, so this hook only owns the
  // local task-list state (statuses, file ops) — the live signal
  // takes care of itself.

  useEffect(() => {
    const wasStreaming = prevStreamIdRef.current != null;
    prevStreamIdRef.current = streamingId;
    if (wasStreaming && streamingId == null) {
      refetchTasks();
    }
  }, [streamingId, refetchTasks]);

  useEffect(() => {
    if (connected && !prevConnectedRef.current) {
      refetchTasks();
    }
    prevConnectedRef.current = connected;
  }, [connected, refetchTasks]);

  // The firehose reported a replay gap (`ws_resync_required`): an
  // unknown number of task lifecycle events was dropped while the
  // socket stayed connected, so the reconnect refetch above never
  // fires. Treat each nonce bump as a forced refetch so todo statuses
  // converge on the server's truth instead of freezing mid-loop.
  const prevResyncNonceRef = useRef(resyncNonce);
  useEffect(() => {
    if (resyncNonce !== prevResyncNonceRef.current) {
      prevResyncNonceRef.current = resyncNonce;
      refetchTasks();
    }
  }, [resyncNonce, refetchTasks]);

  useEffect(() => {
    const unsubs = [
      subscribe(EventType.SpecSaved, (e) => {
        if (e.project_id !== projectId || !e.content.spec) return;
        setLocalSpecs((prev) => upsertSpec(prev, e.content.spec));
      }),
      subscribe(EventType.TaskSaved, (e) => {
        if (e.project_id !== projectId || !e.content.task) return;
        setLocalTasks((prev) => upsertTask(prev, e.content.task));
      }),
      subscribe(EventType.TaskStarted, (e) => {
        const { task_id } = e.content;
        if (!task_id) return;
        updateTaskStatus(task_id, "in_progress", {
          ...(e.session_id ? { session_id: e.session_id } : {}),
        });
      }),
      subscribe(EventType.TaskCompleted, (e) => {
        const { task_id, execution_notes, files } = e.content;
        if (!task_id) return;
        updateTaskStatus(task_id, "done", {
          execution_notes,
          ...(files ? { files_changed: files } : {}),
        });
      }),
      subscribe(EventType.TaskFailed, (e) => {
        const { task_id } = e.content;
        if (task_id) updateTaskStatus(task_id, "failed");
      }),
      // Tool-driven transitions (`transition_task` / `update_task`)
      // emit only a `task_updated` status edge — never a harness
      // `task_completed` / `task_failed` lifecycle event. The dev loop
      // marks tasks done this way, so without consuming the edge here
      // the Tasks tab kept rendering the finished task as in-progress
      // (its stored status stayed `in_progress` from `task_started`
      // while `getTaskDisplayStatus` re-upgraded it via the not-yet-
      // cleared live-task set) until a manual refetch.
      subscribe(EventType.TaskUpdated, (e) => {
        const { task_id, status } = e.content;
        if (!task_id || !status?.to) return;
        if (!isTaskStatus(status.to)) return;
        updateTaskStatus(task_id, status.to);
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
      // LoopStopped / LoopPaused / LoopFinished only need to refetch
      // task statuses from storage; the live-task-id signal clears
      // itself the moment `LoopActivityChanged` flips the loop's
      // `current_task_id` to `None` (or `LoopEnded` removes the row).
      subscribe(EventType.LoopStopped, refetchTasks),
      subscribe(EventType.LoopPaused, refetchTasks),
      subscribe(EventType.LoopFinished, refetchTasks),
    ];
    return () => unsubs.forEach((u) => u());
  }, [projectId, subscribe, updateTaskStatus, refetchTasks]);

  const specs = useMemo(() => {
    const merged = mergeById(localSpecs, storeSpecs, "spec_id").sort(compareSpecs);
    if (deletedSpecIds.length === 0) return merged;
    const deleted = new Set(deletedSpecIds);
    return merged.filter((s) => !deleted.has(s.spec_id));
  }, [localSpecs, storeSpecs, deletedSpecIds]);
  const tasks = useMemo(() => {
    const merged = mergeById(localTasks, storeTasks, "task_id");
    if (deletedTaskIds.length === 0) return merged;
    const deleted = new Set(deletedTaskIds);
    return merged.filter((t) => !deleted.has(t.task_id));
  }, [localTasks, storeTasks, deletedTaskIds]);

  return { specs, tasks, liveTaskIds, loopActive, loading };
}
