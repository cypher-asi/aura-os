import type { ProjectId } from "../types";
import { apiFetch } from "./core";

export interface LoopStatusResponse {
  running: boolean;
  paused: boolean;
  project_id: ProjectId | null;
  agent_instance_id?: string | null;
  active_agent_instances?: string[];
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
};
