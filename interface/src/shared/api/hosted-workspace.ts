import type { ProjectId } from "../types";
import type { DirEntry } from "./desktop";
import { apiFetch } from "./core";

export interface HostedWorkspaceTarget {
  projectId: ProjectId;
  agentInstanceId: string;
}

function workspaceBase({ projectId, agentInstanceId }: HostedWorkspaceTarget) {
  return `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentInstanceId)}/workspace`;
}

export const hostedWorkspaceApi = {
  listFiles: (target: HostedWorkspaceTarget) =>
    apiFetch<{ ok: boolean; entries?: DirEntry[]; error?: string }>(
      `${workspaceBase(target)}/files`,
    ),

  readFile: (target: HostedWorkspaceTarget, path: string) =>
    apiFetch<{ ok: boolean; content?: string; path?: string; error?: string }>(
      `${workspaceBase(target)}/read-file?path=${encodeURIComponent(path)}`,
    ),
};
