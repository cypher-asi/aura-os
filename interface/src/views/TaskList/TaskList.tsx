import { useCallback, useMemo } from "react";
import type { Spec, Task } from "../../types";
import { TaskStatusIcon } from "../../components/TaskStatusIcon";
import { useDelayedEmpty } from "../../hooks/use-delayed-empty";
import { titleSortKey } from "../../utils/collections";
import { filterExplorerNodes } from "../../utils/filterExplorerNodes";
import { Explorer } from "@cypher-asi/zui";
import { EmptyState } from "../../components/EmptyState";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useProjectActions } from "../../stores/project-action-store";
import { api } from "../../api/client";
import { useTaskListData } from "./useTaskListData";
import styles from "../aura.module.css";
import type { ExplorerNode } from "@cypher-asi/zui";
import type { ExplorerNodeWithSuffix } from "../../lib/zui-compat";
import {
  SidekickItemContextMenu,
  useSidekickItemContextMenu,
} from "../../components/SidekickItemContextMenu";
import { DeleteSpecModal } from "../../components/DeleteSpecModal";
import { useDeleteSpec } from "../../hooks/use-delete-spec";

type TaskMenuTarget =
  | { kind: "task"; task: Task }
  | { kind: "spec"; spec: Spec };

export function TaskList({ searchQuery }: { searchQuery: string }) {
  const { specs, tasks, liveTaskIds, loopActive, loading } = useTaskListData();
  const previewItem = useSidekickStore((s) => s.previewItem);
  const streamingAgentInstanceId = useSidekickStore((s) => s.streamingAgentInstanceId);
  const viewTask = useSidekickStore((s) => s.viewTask);
  const removeTask = useSidekickStore((s) => s.removeTask);
  const pushTask = useSidekickStore((s) => s.pushTask);
  const ctx = useProjectActions();
  const projectId = ctx?.project.project_id;

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

      function toNode(task: Task): ExplorerNodeWithSuffix {
        const subtasks = childrenByParent.get(task.task_id);
        const displayStatus =
          task.status === "in_progress" &&
          !liveTaskIds.has(task.task_id) &&
          (!loopActive || liveTaskIds.size > 0)
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
          : [{ id: `${spec.spec_id}__empty`, label: "No tasks yet", metadata: { type: "empty" } }],
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

  const defaultExpandedIds = useMemo(() => explorerData.map((node) => node.id), [explorerData]);

  const previewTaskId =
    previewItem?.kind === "task" ? previewItem.task.task_id : null;
  const defaultSelectedIds = useMemo(() => (previewTaskId ? [previewTaskId] : []), [previewTaskId]);

  const filteredData = useMemo(
    () => filterExplorerNodes(explorerData, searchQuery),
    [explorerData, searchQuery],
  );

  const resolveMenuTarget = useCallback(
    (nodeId: string): TaskMenuTarget | null => {
      const task = taskMap.get(nodeId);
      if (task) return { kind: "task", task };
      const spec = specMap.get(nodeId);
      if (spec) return { kind: "spec", spec };
      return null;
    },
    [taskMap, specMap],
  );
  const { menu, menuRef, handleContextMenu, closeMenu } = useSidekickItemContextMenu({
    resolveItem: resolveMenuTarget,
  });

  const {
    deleteTarget: specDeleteTarget,
    setDeleteTarget: setSpecDeleteTarget,
    deleteLoading: specDeleteLoading,
    deleteError: specDeleteError,
    handleDelete: handleSpecDelete,
    closeDeleteModal: closeSpecDeleteModal,
  } = useDeleteSpec(projectId);

  const handleMenuAction = useCallback(
    (actionId: string) => {
      const target = menu?.item;
      closeMenu();
      if (!target || actionId !== "delete" || !projectId) return;
      if (target.kind === "task") {
        const { task } = target;
        removeTask(task.task_id);
        api.deleteTask(projectId, task.task_id).catch((err) => {
          console.error("Failed to delete task", err);
          pushTask(task);
        });
        return;
      }
      setSpecDeleteTarget(target.spec);
    },
    [menu, closeMenu, projectId, removeTask, pushTask, setSpecDeleteTarget],
  );

  const isEmpty = tasks.length === 0;
  const showEmpty = useDelayedEmpty(isEmpty, loading, streamingAgentInstanceId ? 800 : 0);

  if (isEmpty) {
    if (!showEmpty) return null;
    return <EmptyState>No tasks yet</EmptyState>;
  }

  return (
    <>
      <div onContextMenu={handleContextMenu}>
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
            if (task) viewTask(task);
          }}
        />
      </div>
      {menu && (
        <SidekickItemContextMenu
          x={menu.x}
          y={menu.y}
          menuRef={menuRef}
          onAction={handleMenuAction}
        />
      )}
      <DeleteSpecModal
        target={specDeleteTarget}
        loading={specDeleteLoading}
        error={specDeleteError}
        onClose={closeSpecDeleteModal}
        onDelete={handleSpecDelete}
      />
    </>
  );
}
