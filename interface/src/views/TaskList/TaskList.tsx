import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import type { Spec, Task } from "../../shared/types";
import { LoopProgress } from "../../components/LoopProgress";
import { TaskStatusIcon } from "../../components/TaskStatusIcon";
import {
  selectTaskActivity,
  useLoopActivityStore,
} from "../../stores/loop-activity-store";
import { isLoopActivityActive } from "../../shared/types/aura-events";
import { useDelayedEmpty } from "../../shared/hooks/use-delayed-empty";
import { titleSortKey } from "../../utils/collections";
import { filterExplorerNodes } from "../../shared/utils/filterExplorerNodes";
import { Explorer } from "@cypher-asi/zui";
import { EmptyState } from "../../components/EmptyState";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useProjectActions } from "../../stores/project-action-store";
import { api } from "../../api/client";
import {
  mergeTaskIntoProjectLayout,
  projectQueryKeys,
  removeTaskFromProjectLayout,
  type ProjectLayoutBundle,
} from "../../queries/project-queries";
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
import { useRenameSpec } from "../../hooks/use-rename-spec";

type TaskMenuTarget =
  | { kind: "task"; task: Task }
  | { kind: "spec"; spec: Spec };

/**
 * Explorer-row suffix for a task. Shows the unified circular loop
 * progress indicator when the loop registry reports a live loop for
 * this exact task, otherwise falls back to the static `TaskStatusIcon`
 * so the row still communicates DB-status at a glance.
 */
function TaskRowSuffix({ taskId, status }: { taskId: string; status: Task["status"] }) {
  const activity = useLoopActivityStore(useShallow((s) => selectTaskActivity(s, taskId)));
  if (activity && isLoopActivityActive(activity.status)) {
    return <LoopProgress source={{ activity }} size={14} />;
  }
  return <TaskStatusIcon status={status} />;
}

export function TaskList({ searchQuery }: { searchQuery: string }) {
  const { specs, tasks, liveTaskIds, loopActive, loading } = useTaskListData();
  const previewItem = useSidekickStore((s) => s.previewItem);
  const streamingAgentInstanceId = useSidekickStore((s) => s.streamingAgentInstanceId);
  const viewTask = useSidekickStore((s) => s.viewTask);
  const removeTask = useSidekickStore((s) => s.removeTask);
  const pushTask = useSidekickStore((s) => s.pushTask);
  const ctx = useProjectActions();
  const projectId = ctx?.project.project_id;
  const queryClient = useQueryClient();
  const [renamingId, setRenamingId] = useState<string | null>(null);

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
          suffix: <TaskRowSuffix taskId={task.task_id} status={displayStatus} />,
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
  const { renameSpec } = useRenameSpec(projectId);

  const handleMenuAction = useCallback(
    (actionId: string) => {
      const target = menu?.item;
      closeMenu();
      if (!target || !projectId) return;
      if (actionId === "rename") {
        setRenamingId(target.kind === "task" ? target.task.task_id : target.spec.spec_id);
        return;
      }
      if (actionId !== "delete") return;
      if (target.kind === "task") {
        const { task } = target;
        removeTask(task.task_id);
        // Drop the task from the project-layout cache so Kanban / mobile
        // views that read `initialTasks` reflect the delete immediately.
        queryClient.setQueryData<ProjectLayoutBundle | undefined>(
          projectQueryKeys.layout(projectId),
          (current) => removeTaskFromProjectLayout(current, task.task_id),
        );
        api.deleteTask(projectId, task.task_id).catch((err) => {
          console.error("Failed to delete task", err);
          pushTask(task);
        });
        return;
      }
      setSpecDeleteTarget(target.spec);
    },
    [menu, closeMenu, projectId, queryClient, removeTask, pushTask, setSpecDeleteTarget],
  );

  const handleRenameCommit = useCallback(
    (nodeId: string, rawLabel: string) => {
      setRenamingId(null);
      if (!projectId) return;
      const newTitle = rawLabel.trim();
      if (!newTitle) return;

      const task = taskMap.get(nodeId);
      if (task) {
        if (newTitle === task.title) return;
        const optimistic: Task = { ...task, title: newTitle };
        pushTask(optimistic);
        queryClient.setQueryData<ProjectLayoutBundle | undefined>(
          projectQueryKeys.layout(projectId),
          (current) => mergeTaskIntoProjectLayout(current, optimistic),
        );
        api
          .updateTask(projectId, task.task_id, { title: newTitle })
          .then((updated) => {
            pushTask(updated);
            queryClient.setQueryData<ProjectLayoutBundle | undefined>(
              projectQueryKeys.layout(projectId),
              (current) => mergeTaskIntoProjectLayout(current, updated),
            );
          })
          .catch((err) => {
            console.error("Failed to rename task", err);
            pushTask(task);
            queryClient.setQueryData<ProjectLayoutBundle | undefined>(
              projectQueryKeys.layout(projectId),
              (current) => mergeTaskIntoProjectLayout(current, task),
            );
          });
        return;
      }

      const spec = specMap.get(nodeId);
      if (spec) {
        renameSpec(spec, newTitle).catch(() => {});
      }
    },
    [projectId, taskMap, specMap, pushTask, queryClient, renameSpec],
  );

  const handleRenameCancel = useCallback(() => {
    setRenamingId(null);
  }, []);

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
          editingNodeId={renamingId}
          onRenameCommit={handleRenameCommit}
          onRenameCancel={handleRenameCancel}
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
