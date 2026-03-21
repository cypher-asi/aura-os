import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { api } from "../api/client";
import type { Spec, Task, TaskStatus } from "../types";
import { TaskStatusIcon } from "../components/TaskStatusIcon";
import { useProjectContext } from "../stores/project-action-store";
import { useEventStore } from "../stores/event-store";
import { useSidekick } from "../stores/sidekick-store";
import { useDelayedEmpty } from "../hooks/use-delayed-empty";
import { useLoopActive } from "../hooks/use-loop-active";
import { mergeById, titleSortKey } from "../utils/collections";
import { filterExplorerNodes } from "../utils/filterExplorerNodes";
import { Explorer } from "@cypher-asi/zui";
import { EmptyState } from "../components/EmptyState";
import styles from "./aura.module.css";
import type { ExplorerNode } from "@cypher-asi/zui";

export function TaskList({ searchQuery }: { searchQuery: string }) {
  const ctx = useProjectContext();
  const projectId = ctx?.project.project_id;
  const sidekick = useSidekick();
  const subscribe = useEventStore((s) => s.subscribe);
  const loopActive = useLoopActive(projectId);
  const [liveTaskIds, setLiveTaskIds] = useState<Set<string>>(() => new Set());
  const [localSpecs, setLocalSpecs] = useState<Spec[]>(() => ctx?.initialSpecs ?? []);
  const [localTasks, setLocalTasks] = useState<Task[]>(() => ctx?.initialTasks ?? []);
  const [loading] = useState(false);

  useEffect(() => {
    if (ctx?.initialSpecs) setLocalSpecs(ctx.initialSpecs);
  }, [ctx?.initialSpecs]);

  useEffect(() => {
    if (ctx?.initialTasks) setLocalTasks(ctx.initialTasks);
  }, [ctx?.initialTasks]);

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
          const taskId = e.task_id;
          setLiveTaskIds((prev) => new Set(prev).add(taskId));
          updateTaskStatus(taskId, "in_progress", {
            ...(e.session_id ? { session_id: e.session_id } : {}),
          });
        }
      }),
      subscribe("task_completed", (e) => {
        if (e.task_id) {
          const taskId = e.task_id;
          setLiveTaskIds((prev) => {
            const next = new Set(prev);
            next.delete(taskId);
            return next;
          });
          updateTaskStatus(taskId, "done", {
            execution_notes: e.execution_notes,
            ...(e.files ? { files_changed: e.files } : {}),
          });
        }
      }),
      subscribe("task_failed", (e) => {
        if (e.task_id) {
          const taskId = e.task_id;
          setLiveTaskIds((prev) => {
            const next = new Set(prev);
            next.delete(taskId);
            return next;
          });
          updateTaskStatus(taskId, "failed");
        }
      }),
      subscribe("file_ops_applied", (e) => {
        if (e.task_id && e.files) {
          updateTaskStatus(e.task_id, "in_progress", { files_changed: e.files });
        }
      }),
      subscribe("task_became_ready", (e) => {
        if (e.task_id) updateTaskStatus(e.task_id, "ready");
      }),
      subscribe("tasks_became_ready", (e) => {
        if (!e.task_ids?.length) return;
        setLocalTasks((prev) => {
          const readySet = new Set(e.task_ids);
          return prev.map((t) =>
            readySet.has(t.task_id) ? { ...t, status: "ready" as const } : t,
          );
        });
      }),
      subscribe("follow_up_task_created", () => {
        refetchTasks();
      }),
      subscribe("loop_stopped", refetchTasks),
      subscribe("loop_paused", refetchTasks),
      subscribe("loop_finished", refetchTasks),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, updateTaskStatus, refetchTasks]);

  const specs = useMemo(
    () => mergeById(sidekick.specs, localSpecs, "spec_id"),
    [localSpecs, sidekick.specs],
  );

  const tasks = useMemo(
    () => mergeById(sidekick.tasks, localTasks, "task_id"),
    [localTasks, sidekick.tasks],
  );

  const specMap = useMemo(() => new Map(specs.map((s) => [s.spec_id, s])), [specs]);
  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.task_id, t])), [tasks]);
  const groupedTasks = useMemo(
    () =>
      specs.map((spec) => ({
        spec,
        tasks: tasks
          .filter((t) => t.spec_id === spec.spec_id)
          .sort((a, b) => {
            const ka = titleSortKey(a.title);
            const kb = titleSortKey(b.title);
            if (ka !== kb) return ka - kb;
            return a.order_index - b.order_index;
          }),
      })),
    [specs, tasks],
  );

  const ungrouped = useMemo(
    () => tasks.filter((t) => !specMap.has(t.spec_id)),
    [tasks, specMap],
  );

  const explorerData: ExplorerNode[] = useMemo(() => {
    function buildTaskTree(taskList: Task[]): ExplorerNode[] {
      const childrenByParent = new Map<string, Task[]>();
      const rootTasks: Task[] = [];

      for (const task of taskList) {
        if (task.parent_task_id && taskList.some((t) => t.task_id === task.parent_task_id)) {
          const siblings = childrenByParent.get(task.parent_task_id) ?? [];
          siblings.push(task);
          childrenByParent.set(task.parent_task_id, siblings);
        } else {
          rootTasks.push(task);
        }
      }

      function toNode(task: Task): ExplorerNode {
        const subtasks = childrenByParent.get(task.task_id);
        const displayStatus =
          task.status === "in_progress" && !loopActive && !liveTaskIds.has(task.task_id)
            ? "ready"
            : task.status;
        return {
          id: task.task_id,
          label: task.title,
          suffix: <TaskStatusIcon status={displayStatus} />,
          metadata: { type: "task" },
          ...(subtasks && subtasks.length > 0
            ? { children: subtasks.map(toNode) }
            : {}),
        };
      }

      return rootTasks.map(toNode);
    }

    const specNodes: ExplorerNode[] = groupedTasks.map(({ spec, tasks: specTasks }) => ({
      id: spec.spec_id,
      label: spec.title,
      children:
        specTasks.length > 0
          ? buildTaskTree(specTasks)
          : [
              {
                id: `${spec.spec_id}__empty`,
                label: "No tasks yet",
                metadata: { type: "empty" },
              },
            ],
    }));

    if (ungrouped.length > 0) {
      specNodes.push({
        id: "__other__",
        label: "Other",
        children: buildTaskTree([...ungrouped]),
      });
    }

    return specNodes;
  }, [groupedTasks, ungrouped, loopActive, liveTaskIds]);

  const defaultExpandedIds = useMemo(
    () => explorerData.map((node) => node.id),
    [explorerData],
  );

  const previewTaskId =
    sidekick.previewItem?.kind === "task" ? sidekick.previewItem.task.task_id : null;
  const defaultSelectedIds = useMemo(
    () => (previewTaskId ? [previewTaskId] : []),
    [previewTaskId],
  );

  const filteredData = useMemo(
    () => filterExplorerNodes(explorerData, searchQuery),
    [explorerData, searchQuery],
  );

  const isEmpty = tasks.length === 0;
  const showEmpty = useDelayedEmpty(isEmpty, loading, sidekick.streamingAgentInstanceId ? 800 : 0);

  if (isEmpty) {
    if (!showEmpty) return null;
    return <EmptyState>No tasks yet</EmptyState>;
  }

  return (
    <>
      <Explorer
        data={filteredData}
        className={styles.taskExplorer}
        expandOnSelect
        enableDragDrop={false}
        enableMultiSelect={false}
        defaultExpandedIds={defaultExpandedIds}
        defaultSelectedIds={defaultSelectedIds}
        onSelect={(ids) => {
          const id = [...ids].reverse().find((candidate) => taskMap.has(candidate));
          if (!id) return;
          const task = taskMap.get(id);
          if (task) sidekick.viewTask(task);
        }}
      />
    </>
  );
}
