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
import type { ExplorerNode } from "@cypher-asi/zui";
import { ListTodo } from "lucide-react";

export function TaskList() {
  const ctx = useProjectContext();
  const projectId = ctx?.project.project_id;
  const sidekick = useSidekick();
  const { subscribe } = useEventContext();
  const [localSpecs, setLocalSpecs] = useState<Spec[]>([]);
  const [localTasks, setLocalTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

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
    (taskId: string, newStatus: TaskStatus) => {
      setLocalTasks((prev) =>
        prev.map((t) => (t.task_id === taskId ? { ...t, status: newStatus } : t)),
      );
    },
    [],
  );

  useEffect(() => {
    const unsubs = [
      subscribe("task_started", (e) => {
        if (e.task_id) updateTaskStatus(e.task_id, "in_progress");
      }),
      subscribe("task_completed", (e) => {
        if (e.task_id) updateTaskStatus(e.task_id, "done");
      }),
      subscribe("task_failed", (e) => {
        if (e.task_id) updateTaskStatus(e.task_id, "failed");
      }),
      subscribe("task_became_ready", (e) => {
        if (e.task_id) updateTaskStatus(e.task_id, "ready");
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, updateTaskStatus]);

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
    const specNodes: ExplorerNode[] = groupedTasks.map(({ spec, tasks: specTasks }) => ({
      id: spec.spec_id,
      label: spec.title,
      children: specTasks.map((task) => ({
        id: task.task_id,
        label: task.title,
        suffix: <TaskStatusIcon status={task.status} />,
        metadata: { type: "task" },
      })),
    }));

    if (ungrouped.length > 0) {
      specNodes.push({
        id: "__other__",
        label: "Other",
        children: ungrouped.map((task) => ({
          id: task.task_id,
          label: task.title,
          suffix: <TaskStatusIcon status={task.status} />,
          metadata: { type: "task" },
        })),
      });
    }

    return specNodes;
  }, [groupedTasks, ungrouped]);

  const defaultExpandedIds = useMemo(
    () => explorerData.map((node) => node.id),
    [explorerData],
  );

  const isEmpty = tasks.length === 0;
  const showEmpty = useDelayedEmpty(isEmpty, loading);

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
      searchable
      searchPlaceholder="Search"
      enableDragDrop={false}
      enableMultiSelect={false}
      defaultExpandedIds={defaultExpandedIds}
      onSelect={(ids) => {
        const id = ids[0];
        if (!id) return;
        const task = taskMap.get(id);
        if (task) sidekick.viewTask(task);
      }}
    />
  );
}
