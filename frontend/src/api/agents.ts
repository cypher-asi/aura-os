import type { ProjectId, AgentId, AgentInstanceId, Agent, AgentInstance, Session, SessionEvent, Task } from "../types";
import { apiFetch } from "./core";
import { sendAgentEventStream, sendEventStream } from "./streams";

type ApiRequestOptions = {
  signal?: AbortSignal;
};

export const agentTemplatesApi = {
  list: () => apiFetch<Agent[]>("/api/agents"),
  create: (data: { name: string; role: string; personality: string; system_prompt: string; skills?: string[]; icon?: string; harness?: "local" | "swarm"; machine_type?: string }) =>
    apiFetch<Agent>("/api/agents", { method: "POST", body: JSON.stringify(data) }),
  get: (agentId: AgentId, options?: ApiRequestOptions) =>
    apiFetch<Agent>(`/api/agents/${agentId}`, { signal: options?.signal }),
  update: (agentId: AgentId, data: { name?: string; role?: string; personality?: string; system_prompt?: string; skills?: string[]; icon?: string | null; harness?: "local" | "swarm"; machine_type?: string }) =>
    apiFetch<Agent>(`/api/agents/${agentId}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (agentId: AgentId) => apiFetch<void>(`/api/agents/${agentId}`, { method: "DELETE" }),
  listEvents: (agentId: AgentId, options?: ApiRequestOptions) =>
    apiFetch<SessionEvent[]>(`/api/agents/${agentId}/events`, { signal: options?.signal }),
  sendEventStream: sendAgentEventStream,
};

export const agentInstancesApi = {
  createAgentInstance: (projectId: ProjectId, agentId: AgentId) =>
    apiFetch<AgentInstance>(`/api/projects/${projectId}/agents`, {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId }),
    }),
  listAgentInstances: (projectId: ProjectId) =>
    apiFetch<AgentInstance[]>(`/api/projects/${projectId}/agents`),
  getAgentInstance: (projectId: ProjectId, agentInstanceId: AgentInstanceId, options?: ApiRequestOptions) =>
    apiFetch<AgentInstance>(`/api/projects/${projectId}/agents/${agentInstanceId}`, { signal: options?.signal }),
  updateAgentInstance: (projectId: ProjectId, agentInstanceId: AgentInstanceId, data: Partial<Pick<AgentInstance, "name" | "role" | "personality" | "system_prompt" | "skills" | "icon" | "model">>) =>
    apiFetch<AgentInstance>(`/api/projects/${projectId}/agents/${agentInstanceId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteAgentInstance: (projectId: ProjectId, agentInstanceId: AgentInstanceId) =>
    apiFetch<void>(`/api/projects/${projectId}/agents/${agentInstanceId}`, {
      method: "DELETE",
    }),
  getEvents: (projectId: ProjectId, agentInstanceId: AgentInstanceId, options?: ApiRequestOptions) =>
    apiFetch<SessionEvent[]>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/events`,
      { signal: options?.signal },
    ),
  sendEventStream,
};

export const sessionsApi = {
  listProjectSessions: (projectId: ProjectId) =>
    apiFetch<Session[]>(`/api/projects/${projectId}/sessions`),
  listSessions: (projectId: ProjectId, agentInstanceId: AgentInstanceId) =>
    apiFetch<Session[]>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/sessions`,
    ),
  getSession: (projectId: ProjectId, agentInstanceId: AgentInstanceId, sessionId: string) =>
    apiFetch<Session>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/sessions/${sessionId}`,
    ),
  listSessionTasks: (projectId: ProjectId, agentInstanceId: AgentInstanceId, sessionId: string) =>
    apiFetch<Task[]>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/sessions/${sessionId}/tasks`,
    ),
  listSessionEvents: (projectId: ProjectId, agentInstanceId: AgentInstanceId, sessionId: string) =>
    apiFetch<SessionEvent[]>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/sessions/${sessionId}/events`,
    ),
};
