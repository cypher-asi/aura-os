import type {
  ProjectId,
  SpecId,
  TaskId,
  AgentId,
  AgentInstanceId,
  TaskStatus,
  Project,
  Spec,
  Task,
  Agent,
  AgentInstance,
  Session,
  Message,
  ApiKeyInfo,
  ProjectProgress,
  AuthSession,
  ApiError,
  Org,
  OrgMember,
  OrgInvite,
  OrgBilling,
  OrgRole,
  CreditTier,
  CreditBalance,
  CheckoutSessionResponse,
  DailyCommitActivity,
  Follow,
  BuildStepRecord,
  TestStepRecord,
} from "../types";
import {
  generateSpecsStream,
  sendMessageStream,
  sendAgentMessageStream,
} from "./streams";
import { resolveApiUrl } from "../lib/host-config";

export type {
  SpecGenStreamCallbacks,
  ChatStreamCallbacks,
} from "./streams";

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

export const INSUFFICIENT_CREDITS_EVENT = "insufficient-credits";

export function isInsufficientCreditsError(err: unknown): boolean {
  if (err instanceof ApiClientError) {
    return err.status === 402 || err.body.code === "insufficient_credits";
  }
  if (typeof err === "string") {
    return err.toLowerCase().includes("insufficient credits");
  }
  if (err instanceof Error) {
    return err.message.toLowerCase().includes("insufficient credits");
  }
  return false;
}

export function dispatchInsufficientCredits(): void {
  window.dispatchEvent(new CustomEvent(INSUFFICIENT_CREDITS_EVENT));
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(resolveApiUrl(path), {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
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
  const contentLength = res.headers.get("content-length");
  if (
    res.status === 204 ||
    contentLength === "0" ||
    (contentLength === null && res.status === 202)
  ) {
    return undefined as T;
  }
  return res.json();
}

export interface CreateProjectRequest {
  org_id: string;
  name: string;
  description: string;
  linked_folder_path: string;
  workspace_source?: string;
  workspace_display_path?: string;
  git_repo_url?: string;
  git_branch?: string;
  orbit_base_url?: string;
  orbit_owner?: string;
  orbit_repo?: string;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  linked_folder_path?: string;
  workspace_source?: string;
  workspace_display_path?: string;
  git_repo_url?: string;
  git_branch?: string;
  orbit_base_url?: string;
  orbit_owner?: string;
  orbit_repo?: string;
}

export interface OrbitRepo {
  id?: string;
  name: string;
  owner: string;
  full_name?: string;
  clone_url?: string;
  git_url?: string;
}

export interface OrbitCollaborator {
  user_id?: string;
  username?: string;
  role: string;
  display_name?: string;
}

export interface ImportedProjectFile {
  relative_path: string;
  contents_base64: string;
}

export interface CreateImportedProjectRequest {
  org_id: string;
  name: string;
  description: string;
  files: ImportedProjectFile[];
  build_command?: string;
  test_command?: string;
  git_repo_url?: string;
  git_branch?: string;
  orbit_base_url?: string;
  orbit_owner?: string;
  orbit_repo?: string;
}

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: DirEntry[];
}

export interface LoopStatusResponse {
  running: boolean;
  paused: boolean;
  project_id: ProjectId | null;
  agent_instance_id?: string | null;
  active_agent_instances?: string[];
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
  getFeeSchedule: () =>
    apiFetch<{ model: string; input_cost_per_million: number; output_cost_per_million: number; effective_date: string }[]>(
      "/api/settings/fee-schedule",
    ),
  putFeeSchedule: (entries: { model: string; input_cost_per_million: number; output_cost_per_million: number; effective_date: string }[]) =>
    apiFetch<{ model: string; input_cost_per_million: number; output_cost_per_million: number; effective_date: string }[]>(
      "/api/settings/fee-schedule",
      { method: "PUT", body: JSON.stringify(entries) },
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
      apiFetch<void>(`/api/orgs/${orgId}/invites/${inviteId}`, {
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
    getCreditTiers: (orgId: string) =>
      apiFetch<CreditTier[]>(`/api/orgs/${orgId}/credits/tiers`),
    getCreditBalance: (orgId: string) =>
      apiFetch<CreditBalance>(`/api/orgs/${orgId}/credits/balance`),
    createCreditCheckout: (orgId: string, tierId?: string, customCredits?: number) =>
      apiFetch<CheckoutSessionResponse>(`/api/orgs/${orgId}/credits/checkout`, {
        method: "POST",
        body: JSON.stringify({ tier_id: tierId, credits: customCredits }),
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
  importProject: (data: CreateImportedProjectRequest) =>
    apiFetch<Project>("/api/projects/import", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getProject: (id: ProjectId) => apiFetch<Project>(`/api/projects/${id}`),
  listOrbitRepos: (q?: string) =>
    apiFetch<OrbitRepo[]>(q ? `/api/orbit/repos?q=${encodeURIComponent(q)}` : "/api/orbit/repos"),
  listProjectOrbitCollaborators: (projectId: ProjectId) =>
    apiFetch<OrbitCollaborator[]>(`/api/projects/${projectId}/orbit-collaborators`),
  updateProject: (id: ProjectId, data: UpdateProjectRequest) =>
    apiFetch<Project>(`/api/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteProject: (id: ProjectId) =>
    apiFetch<void>(`/api/projects/${id}`, { method: "DELETE" }),
  archiveProject: (id: ProjectId) =>
    apiFetch<Project>(`/api/projects/${id}/archive`, { method: "POST" }),

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
  runTask: (projectId: ProjectId, taskId: TaskId, agentInstanceId?: string) => {
    const params = agentInstanceId ? `?agent_instance_id=${agentInstanceId}` : "";
    return apiFetch<void>(`/api/projects/${projectId}/tasks/${taskId}/run${params}`, {
      method: "POST",
    });
  },
  getProgress: (projectId: ProjectId) =>
    apiFetch<ProjectProgress>(`/api/projects/${projectId}/progress`),
  getTaskOutput: (projectId: ProjectId, taskId: TaskId) =>
    apiFetch<{ output: string; build_steps?: BuildStepRecord[]; test_steps?: TestStepRecord[] }>(`/api/projects/${projectId}/tasks/${taskId}/output`),

  // Sessions (project-level)
  listProjectSessions: (projectId: ProjectId) =>
    apiFetch<Session[]>(`/api/projects/${projectId}/sessions`),

  // User-level Agents (templates)
  agents: {
    list: () => apiFetch<Agent[]>("/api/agents"),
    create: (data: { name: string; role: string; personality: string; system_prompt: string; skills?: string[]; icon?: string }) =>
      apiFetch<Agent>("/api/agents", { method: "POST", body: JSON.stringify(data) }),
    get: (agentId: AgentId) => apiFetch<Agent>(`/api/agents/${agentId}`),
    update: (agentId: AgentId, data: { name?: string; role?: string; personality?: string; system_prompt?: string; skills?: string[]; icon?: string | null }) =>
      apiFetch<Agent>(`/api/agents/${agentId}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (agentId: AgentId) => apiFetch<void>(`/api/agents/${agentId}`, { method: "DELETE" }),
    listMessages: (agentId: AgentId) =>
      apiFetch<Message[]>(`/api/agents/${agentId}/messages`),
    sendMessageStream: sendAgentMessageStream,
  },

  // Agent Instances (project-level working copies)
  createAgentInstance: (projectId: ProjectId, agentId: AgentId) =>
    apiFetch<AgentInstance>(`/api/projects/${projectId}/agents`, {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId }),
    }),
  listAgentInstances: (projectId: ProjectId) =>
    apiFetch<AgentInstance[]>(`/api/projects/${projectId}/agents`),
  getAgentInstance: (projectId: ProjectId, agentInstanceId: AgentInstanceId) =>
    apiFetch<AgentInstance>(`/api/projects/${projectId}/agents/${agentInstanceId}`),
  updateAgentInstance: (projectId: ProjectId, agentInstanceId: AgentInstanceId, data: Partial<Pick<AgentInstance, "name" | "role" | "personality" | "system_prompt" | "skills" | "icon" | "model">>) =>
    apiFetch<AgentInstance>(`/api/projects/${projectId}/agents/${agentInstanceId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteAgentInstance: (projectId: ProjectId, agentInstanceId: AgentInstanceId) =>
    apiFetch<void>(`/api/projects/${projectId}/agents/${agentInstanceId}`, {
      method: "DELETE",
    }),

  // Messages (per agent instance)
  getMessages: (projectId: ProjectId, agentInstanceId: AgentInstanceId) =>
    apiFetch<Message[]>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/messages`,
    ),
  sendMessageStream,

  // Sessions (per agent instance)
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
  listSessionMessages: (projectId: ProjectId, agentInstanceId: AgentInstanceId, sessionId: string) =>
    apiFetch<Message[]>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/sessions/${sessionId}/messages`,
    ),

  // Log entries
  getLogEntries: (limit = 1000) =>
    apiFetch<{ timestamp_ms: number; event: import("../types/events").EngineEvent }[]>(
      `/api/log-entries?limit=${limit}`,
    ),

  // Desktop file tree
  listDirectory: (path: string) =>
    apiFetch<{ ok: boolean; entries?: DirEntry[]; error?: string }>("/api/list-directory", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),

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
  openIde: (path: string, root?: string) =>
    apiFetch<{ ok: boolean }>("/api/open-ide", {
      method: "POST",
      body: JSON.stringify({ path, root }),
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

  // Updates
  getUpdateStatus: () =>
    apiFetch<{ update: { status: string; version?: string; channel?: string; error?: string }; channel: string; current_version: string }>(
      "/api/update-status",
    ),
  installUpdate: () =>
    apiFetch<{ ok: boolean; error?: string }>("/api/update-install", {
      method: "POST",
    }),
  setUpdateChannel: (channel: "stable" | "nightly") =>
    apiFetch<{ ok: boolean; channel: string }>("/api/update-channel", {
      method: "POST",
      body: JSON.stringify({ channel }),
    }),

  // Loop
  startLoop: (projectId: ProjectId, agentInstanceId?: string) => {
    const params = agentInstanceId ? `?agent_instance_id=${agentInstanceId}` : "";
    return apiFetch<LoopStatusResponse>(
      `/api/projects/${projectId}/loop/start${params}`,
      { method: "POST" },
    );
  },
  pauseLoop: (projectId: ProjectId, agentId?: string) => {
    const params = agentId ? `?agent_id=${agentId}` : "";
    return apiFetch<void>(`/api/projects/${projectId}/loop/pause${params}`, {
      method: "POST",
    });
  },
  stopLoop: (projectId: ProjectId, agentId?: string) => {
    const params = agentId ? `?agent_id=${agentId}` : "";
    return apiFetch<LoopStatusResponse>(`/api/projects/${projectId}/loop/stop${params}`, {
      method: "POST",
    });
  },
  getLoopStatus: (projectId: ProjectId) =>
    apiFetch<LoopStatusResponse>(`/api/projects/${projectId}/loop/status`),

  // Follows
  follows: {
    follow: (targetProfileId: string) =>
      apiFetch<Follow>("/api/follows", {
        method: "POST",
        body: JSON.stringify({ target_profile_id: targetProfileId }),
      }),
    unfollow: (targetProfileId: string) =>
      apiFetch<void>(`/api/follows/${targetProfileId}`, {
        method: "DELETE",
      }),
    list: () => apiFetch<Follow[]>("/api/follows"),
    check: (targetProfileId: string) =>
      apiFetch<{ following: boolean }>(`/api/follows/check/${targetProfileId}`),
  },

  // Users (proxied to aura-network)
  users: {
    me: () => apiFetch<{
      id: string;
      zos_user_id: string | null;
      display_name: string | null;
      avatar_url: string | null;
      bio: string | null;
      location: string | null;
      website: string | null;
      profile_id: string | null;
      created_at: string | null;
      updated_at: string | null;
    }>("/api/users/me"),
    get: (userId: string) => apiFetch<{
      id: string;
      zos_user_id: string | null;
      display_name: string | null;
      avatar_url: string | null;
      bio: string | null;
      location: string | null;
      website: string | null;
      profile_id: string | null;
      created_at: string | null;
      updated_at: string | null;
    }>(`/api/users/${userId}`),
    updateMe: (data: { display_name?: string; avatar_url?: string; bio?: string; location?: string; website?: string }) =>
      apiFetch<{
        id: string;
        zos_user_id: string | null;
        display_name: string | null;
        avatar_url: string | null;
        bio: string | null;
        location: string | null;
        website: string | null;
        profile_id: string | null;
        created_at: string | null;
        updated_at: string | null;
      }>("/api/users/me", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
  },

  // Profiles (proxied to aura-network)
  profiles: {
    get: (profileId: string) => apiFetch<{
      id: string;
      display_name: string | null;
      avatar_url: string | null;
      bio: string | null;
      profile_type: string | null;
      entity_id: string | null;
    }>(`/api/profiles/${profileId}`),
  },

  // Feed (proxied to aura-network)
  feed: {
    list: (filter?: string) =>
      apiFetch<{
        id: string;
        profile_id: string;
        event_type: string;
        metadata: Record<string, unknown> | null;
        created_at: string | null;
      }[]>(filter ? `/api/feed?filter=${filter}` : "/api/feed"),
    getComments: (eventId: string) =>
      apiFetch<{
        id: string;
        activity_event_id: string;
        profile_id: string;
        content: string;
        created_at: string | null;
      }[]>(`/api/activity/${eventId}/comments`),
    addComment: (eventId: string, content: string) =>
      apiFetch<{
        id: string;
        activity_event_id: string;
        profile_id: string;
        content: string;
        created_at: string | null;
      }>(`/api/activity/${eventId}/comments`, {
        method: "POST",
        body: JSON.stringify({ content }),
      }),
    deleteComment: (commentId: string) =>
      apiFetch<void>(`/api/comments/${commentId}`, {
        method: "DELETE",
      }),
  },

  // Leaderboard (proxied to aura-network)
  leaderboard: {
    get: (period: string, orgId?: string) => {
      const params = new URLSearchParams({ period });
      if (orgId) params.set("org_id", orgId);
      return apiFetch<{
        profile_id: string;
        display_name: string | null;
        avatar_url: string | null;
        tokens_used: number;
        rank: number;
        profile_type: string | null;
      }[]>(`/api/leaderboard?${params}`);
    },
  },

  // Usage (proxied to aura-network)
  usage: {
    personal: (period: string) =>
      apiFetch<{
        total_tokens: number;
        total_input_tokens: number;
        total_output_tokens: number;
        total_cost_usd: number;
      }>(`/api/users/me/usage?period=${period}`),
    org: (orgId: string, period: string) =>
      apiFetch<{
        total_tokens: number;
        total_input_tokens: number;
        total_output_tokens: number;
        total_cost_usd: number;
      }>(`/api/orgs/${orgId}/usage?period=${period}`),
    orgMembers: (orgId: string) =>
      apiFetch<{
        user_id: string;
        display_name: string | null;
        avatar_url: string | null;
        total_tokens: number;
        total_cost_usd: number;
      }[]>(`/api/orgs/${orgId}/usage/members`),
  },

  // Activity
  activity: {
    getCommitHistory: (params: {
      user_ids?: string[];
      agent_ids?: string[];
      start_date?: string;
      end_date?: string;
    }) => {
      const qp = new URLSearchParams();
      if (params.user_ids?.length) qp.set("user_ids", params.user_ids.join(","));
      if (params.agent_ids?.length) qp.set("agent_ids", params.agent_ids.join(","));
      if (params.start_date) qp.set("start_date", params.start_date);
      if (params.end_date) qp.set("end_date", params.end_date);
      const qs = qp.toString();
      return apiFetch<DailyCommitActivity[]>(`/api/activity/commits${qs ? `?${qs}` : ""}`);
    },
  },
};
