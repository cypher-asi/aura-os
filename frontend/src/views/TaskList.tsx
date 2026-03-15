import { useEffect, useState, useMemo, useCallback } from "react";
import { api } from "../api/client";
import type { Spec, Task, TaskStatus } from "../types";
import { TaskStatusIcon } from "../components/TaskStatusIcon";
import { useProjectContext } from "../context/ProjectContext";
import { useEventContext } from "../context/EventContext";
import { useSidekick } from "../context/SidekickContext";
import { useDelayedEmpty } from "../hooks/use-delayed-empty";
import { mergeById } from "../utils/collections";
import { Explorer, PageEmptyState } from "@cypher-asi/zui";
import styles from "./aura.module.css";
import type { ExplorerNode } from "@cypher-asi/zui";
import { ListTodo } from "lucide-react";

export function TaskList() {
  const ctx = useProjectContext();
  const projectId = ctx?.project.project_id;
  const sidekick = useSidekick();
  const { subscribe } = useEventContext();
  const [localSpecs, setLocalSpecs] = useState<Spec[]>(() => ctx?.initialSpecs ?? []);
  const [localTasks, setLocalTasks] = useState<Task[]>(() => ctx?.initialTasks ?? []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    Promise.all([api.listSpecs(projectId), api.listTasks(projectId)])
      .then(([s, t]) => {
        setLocalSpecs(s.sort((a, b) => a.order_index - b.order_index));
        setLocalTasks(t.sort((a, b) => a.order_index - b.order_index));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [projectId]);

  const updateTaskStatus = useCallback(
    (taskId: string, newStatus: TaskStatus, extra?: Partial<Task>) => {
      setLocalTasks((prev) =>
        prev.map((t) => (t.task_id === taskId ? { ...t, ...extra, status: newStatus } : t)),
      );
      sidekick.updatePreviewTask({ task_id: taskId, ...extra, status: newStatus });
    },
    [sidekick],
  );

  const refetchTasks = useCallback(() => {
    if (!projectId) return;
    api.listTasks(projectId).then((t) => {
      setLocalTasks(t.sort((a, b) => a.order_index - b.order_index));
    }).catch(console.error);
  }, [projectId]);

  useEffect(() => {
    const unsubs = [
      subscribe("task_started", (e) => {
        if (e.task_id) updateTaskStatus(e.task_id, "in_progress", {
          ...(e.session_id ? { session_id: e.session_id } : {}),
        });
      }),
      subscribe("task_completed", (e) => {
        if (e.task_id) {
          updateTaskStatus(e.task_id, "done", {
            execution_notes: e.execution_notes,
            ...(e.files ? { files_changed: e.files } : {}),
          });
        }
      }),
      subscribe("task_failed", (e) => {
        if (e.task_id) updateTaskStatus(e.task_id, "failed");
      }),
      subscribe("file_ops_applied", (e) => {
        if (e.task_id && e.files) {
          updateTaskStatus(e.task_id, "in_progress", { files_changed: e.files });
        }
      }),
      subscribe("task_became_ready", (e) => {
        if (e.task_id) updateTaskStatus(e.task_id, "ready");
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
    () => mergeById(localSpecs, sidekick.specs, "spec_id"),
    [localSpecs, sidekick.specs],
  );

  const tasks = useMemo(
    () => mergeById(localTasks, sidekick.tasks, "task_id"),
    [localTasks, sidekick.tasks],
  );

  const specMap = useMemo(() => new Map(specs.map((s) => [s.spec_id, s])), [specs]);
  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.task_id, t])), [tasks]);

  const groupedTasks = useMemo(
    () =>
      specs.map((spec) => ({
        spec,
        tasks: tasks.filter((t) => t.spec_id === spec.spec_id),
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
        return {
          id: task.task_id,
          label: task.title,
          suffix: <TaskStatusIcon status={task.status} />,
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
        children: buildTaskTree(ungrouped),
      });
    }

    return specNodes;
  }, [groupedTasks, ungrouped]);

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

  const isEmpty = tasks.length === 0;
  const showEmpty = useDelayedEmpty(isEmpty, loading, sidekick.streamingSessionId ? 800 : 0);

  if (isEmpty) {
    if (!showEmpty) return null;
    return (
      <PageEmptyState
        icon={<ListTodo size={32} />}
        title="No tasks yet"
        description="Tasks are created automatically when specs are generated."
      />
    );
  }

  return (
    <Explorer
      data={explorerData}
      className={styles.taskExplorer}
      searchable
      searchPlaceholder="Search"
      expandOnSelect
      enableDragDrop={false}
      enableMultiSelect={false}
      defaultExpandedIds={defaultExpandedIds}
      defaultSelectedIds={defaultSelectedIds}
      onSelect={(ids) => {
        const id = ids[0];
        if (!id) return;
        const task = taskMap.get(id);
        if (task) sidekick.viewTask(task);
      }}
    />
  );
}
