import type { ProjectId, SpecId, TaskId, TaskStatus, Task, BuildStepRecord, TestStepRecord } from "../types";
import { apiFetch } from "./core";

function runTaskQuery(agentInstanceId?: string, model?: string | null): string {
  const params = new URLSearchParams();
  if (agentInstanceId) params.set("agent_instance_id", agentInstanceId);
  if (model?.trim()) params.set("model", model.trim());
  const query = params.toString();
  return query ? `?${query}` : "";
}

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
  updateTask: (
    projectId: ProjectId,
    taskId: TaskId,
    body: {
      title?: string;
      description?: string;
      order_index?: number;
      dependency_ids?: string[];
      assigned_agent_instance_id?: string;
    },
  ) =>
    apiFetch<Task>(`/api/projects/${projectId}/tasks/${taskId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
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
  runTask: (
    projectId: ProjectId,
    taskId: TaskId,
    agentInstanceId?: string,
    model?: string | null,
  ) => {
    const params = runTaskQuery(agentInstanceId, model);
    return apiFetch<void>(`/api/projects/${projectId}/tasks/${taskId}/run${params}`, {
      method: "POST",
    });
  },
  getTaskOutput: (projectId: ProjectId, taskId: TaskId) =>
    apiFetch<{
      output: string;
      build_steps?: BuildStepRecord[];
      test_steps?: TestStepRecord[];
      git_steps?: {
        type?: string;
        kind?: string;
        reason?: string;
        commit_sha?: string;
        repo?: string;
        branch?: string;
        commits?: { sha: string; message: string }[];
      }[];
      /**
       * When true, the server has no persisted output for this task
       * (e.g. session_id is missing and the fallback scan found nothing).
       * Callers should treat this as a terminal "no output" signal and
       * avoid retrying until the task next starts.
       */
      unavailable?: boolean;
    }>(`/api/projects/${projectId}/tasks/${taskId}/output`),
};
