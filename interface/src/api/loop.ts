import type { ProjectId } from "../types";
import { apiFetch } from "./core";

export interface LoopStatusResponse {
  running: boolean;
  paused: boolean;
  project_id: ProjectId | null;
  agent_instance_id?: string | null;
  active_agent_instances?: string[];
}

export const loopApi = {
  startLoop: (projectId: ProjectId, agentInstanceId?: string) => {
    const params = agentInstanceId ? `?agent_instance_id=${agentInstanceId}` : "";
    return apiFetch<LoopStatusResponse>(
      `/api/projects/${projectId}/loop/start${params}`,
      { method: "POST" },
    );
  },
  pauseLoop: (projectId: ProjectId, agentInstanceId?: string) => {
    const params = agentInstanceId ? `?agent_instance_id=${agentInstanceId}` : "";
    return apiFetch<void>(`/api/projects/${projectId}/loop/pause${params}`, {
      method: "POST",
    });
  },
  stopLoop: (projectId: ProjectId, agentInstanceId?: string) => {
    const params = agentInstanceId ? `?agent_instance_id=${agentInstanceId}` : "";
    return apiFetch<LoopStatusResponse>(`/api/projects/${projectId}/loop/stop${params}`, {
      method: "POST",
    });
  },
  getLoopStatus: (projectId: ProjectId) =>
    apiFetch<LoopStatusResponse>(`/api/projects/${projectId}/loop/status`),
};
