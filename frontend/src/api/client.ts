import type {
  ProjectId,
  SprintId,
  SpecId,
  TaskId,
  AgentId,
  TaskStatus,
  Project,
  Sprint,
  Spec,
  Task,
  Agent,
  Session,
  ChatSession,
  ChatMessage,
  ApiKeyInfo,
  ProjectProgress,
  AuthSession,
  ApiError,
  Org,
  OrgMember,
  OrgInvite,
  OrgBilling,
  OrgGithub,
  OrgRole,
  GitHubIntegration,
  GitHubRepo,
} from "../types";
import {
  generateSprintStream,
  generateSpecsStream,
  sendMessageStream,
} from "./streams";

export type {
  SpecGenStreamCallbacks,
  SprintStreamCallbacks,
  ChatStreamCallbacks,
} from "./streams";

const BASE_URL = "";

export class ApiClientError extends Error {
  status: number;
  body: ApiError;

  constructor(status: number, body: ApiError) {
    super(body.error);
    this.name = "ApiClientError";
    this.status = status;
    this.body = body;
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err: ApiError = await res.json().catch(() => ({
      error: res.statusText,
      code: "unknown",
      details: null,
    }));
    throw new ApiClientError(res.status, err);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface CreateProjectRequest {
  org_id: string;
  name: string;
  description: string;
  linked_folder_path: string;
  github_integration_id?: string;
  github_repo_full_name?: string;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  linked_folder_path?: string;
  github_integration_id?: string;
  github_repo_full_name?: string;
}

export interface LoopStatusResponse {
  running: boolean;
  paused: boolean;
  project_id: ProjectId | null;
}

export const api = {
  // Auth
  auth: {
    login: (email: string, password: string) =>
      apiFetch<AuthSession>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    register: (email: string, password: string) =>
      apiFetch<AuthSession>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    getSession: () => apiFetch<AuthSession>("/api/auth/session"),
    validate: () =>
      apiFetch<AuthSession>("/api/auth/validate", { method: "POST" }),
    logout: () =>
      apiFetch<void>("/api/auth/logout", { method: "POST" }),
  },

  // Settings
  getApiKeyInfo: () => apiFetch<ApiKeyInfo>("/api/settings/api-key"),
  setApiKey: (apiKey: string) =>
    apiFetch<ApiKeyInfo>("/api/settings/api-key", {
      method: "POST",
      body: JSON.stringify({ api_key: apiKey }),
    }),
  deleteApiKey: () =>
    apiFetch<void>("/api/settings/api-key", { method: "DELETE" }),
  getFeeSchedule: () =>
    apiFetch<{ model: string; input_cost_per_million: number; output_cost_per_million: number; effective_date: string }[]>(
      "/api/settings/fee-schedule",
    ),

  // Orgs
  orgs: {
    list: () => apiFetch<Org[]>("/api/orgs"),
    create: (name: string) =>
      apiFetch<Org>("/api/orgs", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    get: (orgId: string) => apiFetch<Org>(`/api/orgs/${orgId}`),
    update: (orgId: string, name: string) =>
      apiFetch<Org>(`/api/orgs/${orgId}`, {
        method: "PUT",
        body: JSON.stringify({ name }),
      }),
    listMembers: (orgId: string) =>
      apiFetch<OrgMember[]>(`/api/orgs/${orgId}/members`),
    updateMemberRole: (orgId: string, userId: string, role: OrgRole) =>
      apiFetch<OrgMember>(`/api/orgs/${orgId}/members/${userId}`, {
        method: "PUT",
        body: JSON.stringify({ role }),
      }),
    removeMember: (orgId: string, userId: string) =>
      apiFetch<void>(`/api/orgs/${orgId}/members/${userId}`, {
        method: "DELETE",
      }),
    createInvite: (orgId: string) =>
      apiFetch<OrgInvite>(`/api/orgs/${orgId}/invites`, { method: "POST" }),
    listInvites: (orgId: string) =>
      apiFetch<OrgInvite[]>(`/api/orgs/${orgId}/invites`),
    revokeInvite: (orgId: string, inviteId: string) =>
      apiFetch<OrgInvite>(`/api/orgs/${orgId}/invites/${inviteId}`, {
        method: "DELETE",
      }),
    acceptInvite: (token: string) =>
      apiFetch<OrgMember>(`/api/invites/${token}/accept`, { method: "POST" }),
    getBilling: (orgId: string) =>
      apiFetch<OrgBilling | null>(`/api/orgs/${orgId}/billing`),
    setBilling: (orgId: string, billing_email: string | null, plan: string) =>
      apiFetch<Org>(`/api/orgs/${orgId}/billing`, {
        method: "PUT",
        body: JSON.stringify({ billing_email, plan }),
      }),
    getGithub: (orgId: string) =>
      apiFetch<OrgGithub | null>(`/api/orgs/${orgId}/integrations/github`),
    setGithub: (orgId: string, github_org: string) =>
      apiFetch<Org>(`/api/orgs/${orgId}/integrations/github`, {
        method: "PUT",
        body: JSON.stringify({ github_org }),
      }),
    removeGithub: (orgId: string) =>
      apiFetch<void>(`/api/orgs/${orgId}/integrations/github`, {
        method: "DELETE",
      }),
    listGithubIntegrations: (orgId: string) =>
      apiFetch<GitHubIntegration[]>(`/api/orgs/${orgId}/integrations/github/app`),
    startGithubInstall: (orgId: string) =>
      apiFetch<{ install_url: string }>(`/api/orgs/${orgId}/integrations/github/install`, {
        method: "POST",
      }),
    removeGithubIntegration: (orgId: string, integrationId: string) =>
      apiFetch<void>(`/api/orgs/${orgId}/integrations/github/${integrationId}`, {
        method: "DELETE",
      }),
    listGithubRepos: (orgId: string) =>
      apiFetch<GitHubRepo[]>(`/api/orgs/${orgId}/integrations/github/repos`),
    refreshGithubIntegration: (orgId: string, integrationId: string) =>
      apiFetch<GitHubRepo[]>(`/api/orgs/${orgId}/integrations/github/${integrationId}/refresh`, {
        method: "POST",
      }),
  },

  // Projects
  listProjects: (orgId?: string) =>
    apiFetch<Project[]>(orgId ? `/api/projects?org_id=${orgId}` : "/api/projects"),
  createProject: (data: CreateProjectRequest) =>
    apiFetch<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getProject: (id: ProjectId) => apiFetch<Project>(`/api/projects/${id}`),
  updateProject: (id: ProjectId, data: UpdateProjectRequest) =>
    apiFetch<Project>(`/api/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteProject: (id: ProjectId) =>
    apiFetch<void>(`/api/projects/${id}`, { method: "DELETE" }),
  archiveProject: (id: ProjectId) =>
    apiFetch<Project>(`/api/projects/${id}/archive`, { method: "POST" }),

  // Sprints
  listSprints: (projectId: ProjectId) =>
    apiFetch<Sprint[]>(`/api/projects/${projectId}/sprints`),
  createSprint: (projectId: ProjectId, title: string, prompt?: string) =>
    apiFetch<Sprint>(`/api/projects/${projectId}/sprints`, {
      method: "POST",
      body: JSON.stringify({ title, prompt: prompt ?? "" }),
    }),
  getSprint: (projectId: ProjectId, sprintId: SprintId) =>
    apiFetch<Sprint>(`/api/projects/${projectId}/sprints/${sprintId}`),
  updateSprint: (projectId: ProjectId, sprintId: SprintId, data: { title?: string; prompt?: string }) =>
    apiFetch<Sprint>(`/api/projects/${projectId}/sprints/${sprintId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteSprint: (projectId: ProjectId, sprintId: SprintId) =>
    apiFetch<void>(`/api/projects/${projectId}/sprints/${sprintId}`, {
      method: "DELETE",
    }),
  reorderSprints: (projectId: ProjectId, sprintIds: SprintId[]) =>
    apiFetch<Sprint[]>(`/api/projects/${projectId}/sprints/reorder`, {
      method: "PUT",
      body: JSON.stringify({ sprint_ids: sprintIds }),
    }),
  generateSprint: (projectId: ProjectId, sprintId: SprintId) =>
    apiFetch<Sprint>(`/api/projects/${projectId}/sprints/${sprintId}/generate`, {
      method: "POST",
    }),
  generateSprintStream,

  // Specs
  listSpecs: (projectId: ProjectId) =>
    apiFetch<Spec[]>(`/api/projects/${projectId}/specs`),
  getSpec: (projectId: ProjectId, specId: SpecId) =>
    apiFetch<Spec>(`/api/projects/${projectId}/specs/${specId}`),
  generateSpecs: (projectId: ProjectId) =>
    apiFetch<Spec[]>(`/api/projects/${projectId}/specs/generate`, {
      method: "POST",
    }),
  generateSpecsStream,

  // Tasks
  listTasks: (projectId: ProjectId) =>
    apiFetch<Task[]>(`/api/projects/${projectId}/tasks`),
  listTasksBySpec: (projectId: ProjectId, specId: SpecId) =>
    apiFetch<Task[]>(`/api/projects/${projectId}/specs/${specId}/tasks`),
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
  runTask: (projectId: ProjectId, taskId: TaskId) =>
    apiFetch<void>(`/api/projects/${projectId}/tasks/${taskId}/run`, {
      method: "POST",
    }),
  getProgress: (projectId: ProjectId) =>
    apiFetch<ProjectProgress>(`/api/projects/${projectId}/progress`),
  getTaskOutput: (projectId: ProjectId, taskId: TaskId) =>
    apiFetch<{ output: string }>(`/api/projects/${projectId}/tasks/${taskId}/output`),

  // Sessions (project-level)
  listProjectSessions: (projectId: ProjectId) =>
    apiFetch<Session[]>(`/api/projects/${projectId}/sessions`),

  // Agents
  listAgents: (projectId: ProjectId) =>
    apiFetch<Agent[]>(`/api/projects/${projectId}/agents`),
  getAgent: (projectId: ProjectId, agentId: AgentId) =>
    apiFetch<Agent>(`/api/projects/${projectId}/agents/${agentId}`),
  listSessions: (projectId: ProjectId, agentId: AgentId) =>
    apiFetch<Session[]>(
      `/api/projects/${projectId}/agents/${agentId}/sessions`,
    ),
  getSession: (projectId: ProjectId, agentId: AgentId, sessionId: string) =>
    apiFetch<Session>(
      `/api/projects/${projectId}/agents/${agentId}/sessions/${sessionId}`,
    ),
  listSessionTasks: (projectId: ProjectId, agentId: AgentId, sessionId: string) =>
    apiFetch<Task[]>(
      `/api/projects/${projectId}/agents/${agentId}/sessions/${sessionId}/tasks`,
    ),

  // Chat Sessions
  createChatSession: (projectId: ProjectId, title: string) =>
    apiFetch<ChatSession>(`/api/projects/${projectId}/chat-sessions`, {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  listChatSessions: (projectId: ProjectId) =>
    apiFetch<ChatSession[]>(`/api/projects/${projectId}/chat-sessions`),
  updateChatSession: (projectId: ProjectId, chatSessionId: string, title: string) =>
    apiFetch<ChatSession>(`/api/projects/${projectId}/chat-sessions/${chatSessionId}`, {
      method: "PUT",
      body: JSON.stringify({ title }),
    }),
  deleteChatSession: (projectId: ProjectId, chatSessionId: string) =>
    apiFetch<void>(`/api/projects/${projectId}/chat-sessions/${chatSessionId}`, {
      method: "DELETE",
    }),
  getChatMessages: (projectId: ProjectId, chatSessionId: string) =>
    apiFetch<ChatMessage[]>(
      `/api/projects/${projectId}/chat-sessions/${chatSessionId}/messages`,
    ),
  sendMessageStream,

  // Log entries
  getLogEntries: (limit = 1000) =>
    apiFetch<{ timestamp_ms: number; event: import("../types/events").EngineEvent }[]>(
      `/api/log-entries?limit=${limit}`,
    ),

  // Desktop file/folder picker
  pickFolder: () =>
    apiFetch<string | null>("/api/pick-folder", { method: "POST" }),
  pickFile: () =>
    apiFetch<string | null>("/api/pick-file", { method: "POST" }),
  openPath: (path: string) =>
    apiFetch<{ ok: boolean; error?: string }>("/api/open-path", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  readFile: (path: string) =>
    apiFetch<{ ok: boolean; content?: string; path?: string; error?: string }>("/api/read-file", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  writeFile: (path: string, content: string) =>
    apiFetch<{ ok: boolean; path?: string; error?: string }>("/api/write-file", {
      method: "POST",
      body: JSON.stringify({ path, content }),
    }),

  // Loop
  startLoop: (projectId: ProjectId) =>
    apiFetch<LoopStatusResponse>(
      `/api/projects/${projectId}/loop/start`,
      { method: "POST" },
    ),
  pauseLoop: (projectId: ProjectId) =>
    apiFetch<void>(`/api/projects/${projectId}/loop/pause`, {
      method: "POST",
    }),
  stopLoop: (projectId: ProjectId) =>
    apiFetch<void>(`/api/projects/${projectId}/loop/stop`, {
      method: "POST",
    }),
};
