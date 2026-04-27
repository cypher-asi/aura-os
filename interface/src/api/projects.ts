import type { ProjectId, SpecId, Project, Spec } from "../types";
import { apiFetch } from "./core";
import { generateSpecsStream } from "./streams";

export interface CreateProjectRequest {
  org_id: string;
  name: string;
  description: string;
  git_repo_url?: string;
  git_branch?: string;
  orbit_base_url?: string;
  orbit_owner?: string;
  orbit_repo?: string;
  /** Local-only working directory (absolute OS path). */
  local_workspace_path?: string | null;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  git_repo_url?: string;
  git_branch?: string;
  orbit_base_url?: string;
  orbit_owner?: string;
  orbit_repo?: string;
  /**
   * Patch semantics for the local workspace override:
   * - `undefined` (omitted): leave the stored value unchanged.
   * - `null` or `""`: clear the override.
   * - `string`: set the override to this absolute path.
   */
  local_workspace_path?: string | null;
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
  local_workspace_path?: string | null;
}

export interface UpdateSpecRequest {
  title?: string;
  order_index?: number;
  markdown_contents?: string;
}

export interface ProjectStatsData {
  total_tasks: number;
  pending_tasks: number;
  ready_tasks: number;
  in_progress_tasks: number;
  blocked_tasks: number;
  done_tasks: number;
  failed_tasks: number;
  completion_percentage: number;
  total_tokens: number;
  total_events: number;
  total_agents: number;
  total_sessions: number;
  total_time_seconds: number;
  lines_changed: number;
  total_specs: number;
  contributors: number;
  estimated_cost_usd: number;
}

export const projectsApi = {
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
  restoreProject: (id: ProjectId) =>
    apiFetch<Project>(`/api/projects/${id}/restore`, { method: "POST" }),
  listDeletedProjects: (orgId?: string) => {
    const qs = orgId ? `?org_id=${encodeURIComponent(orgId)}` : "";
    return apiFetch<Project[]>(`/api/projects/deleted${qs}`);
  },
  archiveProject: (id: ProjectId) =>
    apiFetch<Project>(`/api/projects/${id}/archive`, { method: "POST" }),

  listSpecs: (projectId: ProjectId) =>
    apiFetch<Spec[]>(`/api/projects/${projectId}/specs`),
  getSpec: (projectId: ProjectId, specId: SpecId) =>
    apiFetch<Spec>(`/api/projects/${projectId}/specs/${specId}`),
  deleteSpec: (projectId: ProjectId, specId: SpecId) =>
    apiFetch<void>(`/api/projects/${projectId}/specs/${specId}`, { method: "DELETE" }),
  updateSpec: (projectId: ProjectId, specId: SpecId, body: UpdateSpecRequest) =>
    apiFetch<Spec>(`/api/projects/${projectId}/specs/${specId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  generateSpecs: (projectId: ProjectId, agentInstanceId?: string | null) => {
    const params = agentInstanceId ? `?agent_instance_id=${encodeURIComponent(agentInstanceId)}` : "";
    return apiFetch<Spec[]>(`/api/projects/${projectId}/specs/generate${params}`, {
      method: "POST",
    });
  },
  generateSpecsStream,
  getProjectStats: (projectId: ProjectId) =>
    apiFetch<ProjectStatsData>(`/api/projects/${projectId}/stats`),
};
