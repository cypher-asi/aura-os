import { apiFetch } from "./core";

export type SourceControlArea = "staged" | "worktree";

export interface SourceControlFile {
  path: string;
  original_path?: string;
  staged_status?: string;
  worktree_status?: string;
}

export interface SourceControlPullRequest {
  provider: string;
  number: number;
  title: string;
  state: string;
  url: string;
  head_branch: string;
  base_branch: string;
}

export interface SourceControlStatus {
  available: boolean;
  unavailable_reason?: string;
  branch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  files: SourceControlFile[];
  pull_request?: SourceControlPullRequest;
}

export interface SourceControlDiff {
  path: string;
  area: SourceControlArea;
  diff: string;
  truncated: boolean;
  binary: boolean;
}

export interface SourceControlCommitResult {
  ok: boolean;
  commit: string;
}

function projectPath(projectId: string, suffix = ""): string {
  return `/api/projects/${encodeURIComponent(projectId)}/source-control${suffix}`;
}

function withAgentInstance(
  params: URLSearchParams,
  agentInstanceId?: string,
): URLSearchParams {
  if (agentInstanceId) params.set("agent_instance_id", agentInstanceId);
  return params;
}

function requestBody(agentInstanceId: string | undefined, body: object): string {
  return JSON.stringify({
    ...body,
    ...(agentInstanceId ? { agent_instance_id: agentInstanceId } : {}),
  });
}

export const sourceControlApi = {
  getStatus: (projectId: string, agentInstanceId?: string) => {
    const query = withAgentInstance(new URLSearchParams(), agentInstanceId);
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return apiFetch<SourceControlStatus>(`${projectPath(projectId)}${suffix}`, {
      timeoutMs: 8_000,
    });
  },

  getDiff: (
    projectId: string,
    path: string,
    area: SourceControlArea,
    agentInstanceId?: string,
  ) => {
    const query = withAgentInstance(
      new URLSearchParams({ path, area }),
      agentInstanceId,
    );
    return apiFetch<SourceControlDiff>(
      `${projectPath(projectId, "/diff")}?${query.toString()}`,
      { timeoutMs: 10_000 },
    );
  },

  stage: (projectId: string, paths: string[], agentInstanceId?: string) =>
    apiFetch<{ ok: boolean }>(projectPath(projectId, "/stage"), {
      method: "POST",
      body: requestBody(agentInstanceId, { paths }),
      timeoutMs: 15_000,
    }),

  unstage: (projectId: string, paths: string[], agentInstanceId?: string) =>
    apiFetch<{ ok: boolean }>(projectPath(projectId, "/unstage"), {
      method: "POST",
      body: requestBody(agentInstanceId, { paths }),
      timeoutMs: 15_000,
    }),

  commit: (
    projectId: string,
    message: string,
    agentInstanceId?: string,
  ) =>
    apiFetch<SourceControlCommitResult>(projectPath(projectId, "/commit"), {
      method: "POST",
      body: requestBody(agentInstanceId, { message }),
      timeoutMs: 30_000,
    }),
};
