import { useEffect } from "react";
import { useKanbanStore, useKanbanLanes } from "../stores/kanban-store";
import { useEventStore } from "../../../stores/event-store/index";
import { EventType } from "../../../types/aura-events";

export function useKanbanData(
  projectId: string | undefined,
  agentInstanceId?: string,
) {
  const fetchTasks = useKanbanStore((s) => s.fetchTasks);
  const addTask = useKanbanStore((s) => s.addTask);
  const patchTask = useKanbanStore((s) => s.patchTask);
  const subscribe = useEventStore((s) => s.subscribe);
  const result = useKanbanLanes(projectId, agentInstanceId);

  useEffect(() => {
    if (projectId) fetchTasks(projectId);
  }, [projectId, fetchTasks]);

  useEffect(() => {
    if (!projectId) return;

    const unsubs = [
      subscribe(EventType.TaskSaved, (e) => {
        if (e.project_id !== projectId || !e.content.task) return;
        addTask(projectId, e.content.task);
      }),
      subscribe(EventType.TaskStarted, (e) => {
        if (e.project_id !== projectId || !e.content.task_id) return;
        patchTask(projectId, e.content.task_id, { status: "in_progress" });
      }),
      subscribe(EventType.TaskCompleted, (e) => {
        if (e.project_id !== projectId || !e.content.task_id) return;
        patchTask(projectId, e.content.task_id, { status: "done" });
      }),
      subscribe(EventType.TaskFailed, (e) => {
        if (e.project_id !== projectId || !e.content.task_id) return;
        patchTask(projectId, e.content.task_id, { status: "failed" });
      }),
    ];

    return () => unsubs.forEach((u) => u());
  }, [addTask, projectId, subscribe, patchTask]);

  return result;
}
