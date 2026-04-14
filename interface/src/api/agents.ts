import type { ProjectId, AgentId, AgentInstanceId, Agent, AgentInstance, AgentRuntimeTestResult, Session, SessionEvent, Task } from "../types";
import { apiFetch } from "./core";
import { sendAgentEventStream, sendEventStream } from "./streams";

type ApiRequestOptions = {
  signal?: AbortSignal;
};

export const STANDALONE_AGENT_HISTORY_LIMIT = 80;

interface AgentEventsRequestOptions extends ApiRequestOptions {
  limit?: number;
  offset?: number;
}

export const agentTemplatesApi = {
  list: () => apiFetch<Agent[]>("/api/agents"),
  create: (data: {
    org_id?: string;
    name: string;
    role: string;
    personality: string;
    system_prompt: string;
    skills?: string[];
    icon?: string;
    machine_type?: string;
    adapter_type?: string;
    environment?: string;
    auth_source?: string;
    integration_id?: string | null;
    default_model?: string | null;
  }) =>
    apiFetch<Agent>("/api/agents", { method: "POST", body: JSON.stringify(data) }),
  get: (agentId: AgentId, options?: ApiRequestOptions) =>
    apiFetch<Agent>(`/api/agents/${agentId}`, { signal: options?.signal }),
  update: (agentId: AgentId, data: {
    name?: string;
    role?: string;
    personality?: string;
    system_prompt?: string;
    skills?: string[];
    icon?: string | null;
    machine_type?: string;
    adapter_type?: string;
    environment?: string;
    auth_source?: string;
    integration_id?: string | null;
    default_model?: string | null;
  }) =>
    apiFetch<Agent>(`/api/agents/${agentId}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (agentId: AgentId) => apiFetch<void>(`/api/agents/${agentId}`, { method: "DELETE" }),
  listProjectBindings: (agentId: AgentId) =>
    apiFetch<{ project_agent_id: string; project_id: string; project_name: string }[]>(`/api/agents/${agentId}/projects`),
  removeProjectBinding: (agentId: AgentId, projectAgentId: string) =>
    apiFetch<void>(`/api/agents/${agentId}/projects/${projectAgentId}`, { method: "DELETE" }),
  listEvents: (agentId: AgentId, options?: AgentEventsRequestOptions) => {
    const params = new URLSearchParams();
    if (options?.limit != null) {
      params.set("limit", String(options.limit));
    }
    if (options?.offset != null) {
      params.set("offset", String(options.offset));
    }
    const query = params.size > 0 ? `?${params.toString()}` : "";
    return apiFetch<SessionEvent[]>(`/api/agents/${agentId}/events${query}`, {
      signal: options?.signal,
    });
  },
  sendEventStream: sendAgentEventStream,
  testRuntime: (agentId: AgentId) =>
    apiFetch<AgentRuntimeTestResult>(`/api/agents/${agentId}/runtime/test`, { method: "POST" }),
};

export const agentInstancesApi = {
  createAgentInstance: (projectId: ProjectId, agentId: AgentId) =>
    apiFetch<AgentInstance>(`/api/projects/${projectId}/agents`, {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId }),
    }),
  createGeneralAgentInstance: (projectId: ProjectId) =>
    apiFetch<AgentInstance>(`/api/projects/${projectId}/agents`, {
      method: "POST",
      body: JSON.stringify({ kind: "general" }),
    }),
  listAgentInstances: (projectId: ProjectId) =>
    apiFetch<AgentInstance[]>(`/api/projects/${projectId}/agents`),
  getAgentInstance: (projectId: ProjectId, agentInstanceId: AgentInstanceId, options?: ApiRequestOptions) =>
    apiFetch<AgentInstance>(`/api/projects/${projectId}/agents/${agentInstanceId}`, { signal: options?.signal }),
  updateAgentInstance: (
    projectId: ProjectId,
    agentInstanceId: AgentInstanceId,
    data: Partial<Pick<AgentInstance, "name" | "status">>,
  ) =>
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

export const superAgentApi = {
  setup: () => apiFetch<{ agent: Agent; created: boolean }>("/api/super-agent/setup", { method: "POST" }),
  listOrchestrations: () => apiFetch<unknown[]>("/api/super-agent/orchestrations"),
  getOrchestration: (id: string) => apiFetch<unknown>(`/api/super-agent/orchestrations/${id}`),
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
  summarizeSession: (projectId: ProjectId, agentInstanceId: AgentInstanceId, sessionId: string) =>
    apiFetch<Session>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/sessions/${sessionId}/summarize`,
      { method: "POST" },
    ),
};
