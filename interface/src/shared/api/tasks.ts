import type { ProjectId, SpecId, TaskId, TaskStatus, Task, BuildStepRecord, TestStepRecord } from "../types";
import type { ContextUsageResponse } from "./agents";
import { apiFetch } from "./core";

type ApiRequestOptions = {
  signal?: AbortSignal;
};

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
  createTask: (projectId: ProjectId, body: { title: string; spec_id?: string; description?: string; status?: "backlog" | "to_do"; order_index?: number; assigned_agent_instance_id?: string }) =>
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
  /**
   * User-initiated "Re-do" of a previously completed (`done`) task.
   * Resets the row to `ready` (via the dedicated `done -> ready`
   * storage edge) and clears the persisted `attempts` counter so the
   * dev-loop's auto-retry budget starts fresh on the next run. Pair
   * with `runTask` to fire an immediate one-shot harness run; if the
   * automation loop is already running it will pick the task up on
   * the next iteration regardless.
   */
  redoTask: (projectId: ProjectId, taskId: TaskId) =>
    apiFetch<Task>(`/api/projects/${projectId}/tasks/${taskId}/redo`, {
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
      sync_state?: {
        phase?: string;
        commit_sha?: string;
        branch?: string;
        remote?: string;
        reason?: string;
        attempt?: number;
        orphaned_commits?: string[];
        needs_reconciliation?: boolean;
      };
      checkpoints?: {
        execution_started: boolean;
        files_changed: boolean;
        verification_passed: boolean;
        commit_created: boolean;
        push_confirmed: boolean;
        push_failed: boolean;
      };
      recovery_point?: {
        kind: "pending_push" | "retry_push";
        commit_sha: string;
        retry_safe: boolean;
      };
      /**
       * Advisory next action the server's recovery reconciler would
       * pick for this task given only persisted state. The backend
       * does not yet act on it automatically — it is surfaced so the
       * UI can show recovery intent (e.g. "retrying push of abc1234"
       * or "decomposing truncated work") instead of a bare failure.
       *
       * Absent when the reconciler would return "noop" (no recovery
       * point, no terminal failure classification).
       */
      recommended_action?:
        | { action: "adopt_run" }
        | { action: "retry_push"; commit_sha: string; retry_safe: boolean }
        | { action: "retry_task" }
        | {
            action: "mark_terminal";
            reason:
              | "retry_budget_exhausted"
              | "rate_limited"
              | "commit_failed"
              | "truncation";
          }
        | { action: "noop" };
      /**
       * When true, the server has no persisted output for this task
       * (e.g. session_id is missing and the fallback scan found nothing).
       * Callers should treat this as a terminal "no output" signal and
       * avoid retrying until the task next starts.
       */
      unavailable?: boolean;
    }>(`/api/projects/${projectId}/tasks/${taskId}/output`),
  /**
   * Latest persisted context-utilization for a task's session, filtered
   * to events whose `content.task_id` matches this task. Used by
   * `TaskHeaderContextUsage` to seed the per-task pill after a page
   * reload — without this, tasks that completed in a prior browser
   * session show no pill until they are re-run.
   *
   * Returns `context_utilization: 0` (with no breakdown) when the task
   * has no session, the session has no qualifying `assistant_message_end`,
   * or storage is unavailable. The frontend's `utilization > 0`
   * visibility guard renders nothing in those cases.
   */
  getContextUsage: (
    projectId: ProjectId,
    taskId: TaskId,
    options?: ApiRequestOptions,
  ) =>
    apiFetch<ContextUsageResponse>(
      `/api/projects/${projectId}/tasks/${taskId}/context-usage`,
      { signal: options?.signal },
    ),
};
