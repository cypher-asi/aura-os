import type { ProjectId, SpecId, TaskId, TaskStatus, Task, BuildStepRecord, TestStepRecord } from "../types";
import { apiFetch } from "./core";

export const tasksApi = {
  listTasks: (projectId: ProjectId) =>
    apiFetch<Task[]>(`/api/projects/${projectId}/tasks`),
  createTask: (projectId: ProjectId, body: { title: string; spec_id: string; description?: string; status?: "backlog" | "to_do"; order_index?: number; assigned_agent_instance_id?: string }) =>
    apiFetch<Task>(`/api/projects/${projectId}/tasks`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listTasksBySpec: (projectId: ProjectId, specId: SpecId) =>
    apiFetch<Task[]>(`/api/projects/${projectId}/specs/${specId}/tasks`),
  deleteTask: (projectId: ProjectId, taskId: TaskId) =>
    apiFetch<void>(`/api/projects/${projectId}/tasks/${taskId}`, { method: "DELETE" }),
  transitionTask: (
    projectId: ProjectId,
    taskId: TaskId,
    newStatus: TaskStatus,
  ) =>
    apiFetch<Task>(
      `/api/projects/${projectId}/tasks/${taskId}/transition`,
      {
        method: "POST",
        body: JSON.stringify({ new_status: newStatus }),
      },
    ),
  retryTask: (projectId: ProjectId, taskId: TaskId) =>
    apiFetch<Task>(`/api/projects/${projectId}/tasks/${taskId}/retry`, {
      method: "POST",
    }),
  runTask: (projectId: ProjectId, taskId: TaskId, agentInstanceId?: string) => {
    const params = agentInstanceId ? `?agent_instance_id=${agentInstanceId}` : "";
    return apiFetch<void>(`/api/projects/${projectId}/tasks/${taskId}/run${params}`, {
      method: "POST",
    });
  },
  getTaskOutput: (projectId: ProjectId, taskId: TaskId) =>
    apiFetch<{ output: string; build_steps?: BuildStepRecord[]; test_steps?: TestStepRecord[] }>(`/api/projects/${projectId}/tasks/${taskId}/output`),
};
