import type { ProjectId } from "../shared/types";
import type { LoopActivityPayload, LoopIdPayload, LoopKind } from "../shared/types/aura-events";
import { apiFetch } from "./core";

export interface ActiveLoopTask {
  task_id: string;
  agent_instance_id: string;
}

export interface LoopsSnapshotEntry {
  loop_id: LoopIdPayload;
  activity: LoopActivityPayload;
}

export interface LoopsSnapshotResponse {
  loops: LoopsSnapshotEntry[];
}

export interface LoopsFilter {
  project_id?: string;
  agent_instance_id?: string;
  task_id?: string;
  kind?: LoopKind;
}

export interface LoopStatusResponse {
  running: boolean;
  paused: boolean;
  project_id: ProjectId | null;
  agent_instance_id?: string | null;
  active_agent_instances?: string[];
  /**
   * Per-agent tasks currently streaming output, populated by the
   * server from the in-memory automaton registry. Used to rehydrate
   * the Run panel rows and the TaskList "live" indicator after a page
   * refresh (`task_started` WS events are not replayed, so this is
   * the only HTTP path that reveals what task is running right now).
   */
  active_tasks?: ActiveLoopTask[];
}

function loopQuery(agentInstanceId?: string, model?: string | null): string {
  const params = new URLSearchParams();
  if (agentInstanceId) params.set("agent_instance_id", agentInstanceId);
  if (model?.trim()) params.set("model", model.trim());
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const loopApi = {
  startLoop: (projectId: ProjectId, agentInstanceId?: string, model?: string | null) => {
    const params = loopQuery(agentInstanceId, model);
    return apiFetch<LoopStatusResponse>(
      `/api/projects/${projectId}/loop/start${params}`,
      { method: "POST" },
    );
  },
  pauseLoop: (projectId: ProjectId, agentInstanceId?: string) => {
    const params = loopQuery(agentInstanceId);
    return apiFetch<void>(`/api/projects/${projectId}/loop/pause${params}`, {
      method: "POST",
    });
  },
  stopLoop: (projectId: ProjectId, agentInstanceId?: string) => {
    const params = loopQuery(agentInstanceId);
    return apiFetch<LoopStatusResponse>(`/api/projects/${projectId}/loop/stop${params}`, {
      method: "POST",
    });
  },
  resumeLoop: (projectId: ProjectId, agentInstanceId?: string) => {
    const params = loopQuery(agentInstanceId);
    return apiFetch<LoopStatusResponse>(`/api/projects/${projectId}/loop/resume${params}`, {
      method: "POST",
    });
  },
  getLoopStatus: (projectId: ProjectId) =>
    apiFetch<LoopStatusResponse>(`/api/projects/${projectId}/loop/status`),

  /**
   * Snapshot the `LoopRegistry` in one round trip. Used to hydrate the
   * unified circular progress indicator store on boot / reconnect so
   * the indicator is accurate even before any `loop_activity_changed`
   * WS event arrives for the open loops.
   */
  listLoops: (filter?: LoopsFilter) => {
    const params = new URLSearchParams();
    if (filter?.project_id) params.set("project_id", filter.project_id);
    if (filter?.agent_instance_id)
      params.set("agent_instance_id", filter.agent_instance_id);
    if (filter?.task_id) params.set("task_id", filter.task_id);
    if (filter?.kind) params.set("kind", filter.kind);
    const query = params.toString();
    return apiFetch<LoopsSnapshotResponse>(
      `/api/loops${query ? `?${query}` : ""}`,
    );
  },
};
