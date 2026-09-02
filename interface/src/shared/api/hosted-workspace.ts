import type { ProjectId } from "../types";
import type { DirEntry } from "./desktop";
import { apiFetch } from "./core";
import {
  encodeUtf8Base64,
  type WorkspaceFileReadResult,
  type WorkspaceFileWriteResult,
} from "./workspace-files";

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
    apiFetch<WorkspaceFileReadResult>(
      `${workspaceBase(target)}/read-file?path=${encodeURIComponent(path)}`,
    ),

  writeFile: (
    target: HostedWorkspaceTarget,
    path: string,
    content: string,
    expectedRevision: string,
  ) =>
    apiFetch<WorkspaceFileWriteResult>(`${workspaceBase(target)}/write-file`, {
      method: "PUT",
      body: JSON.stringify({
        path,
        content_base64: encodeUtf8Base64(content),
        expected_revision: expectedRevision,
      }),
    }),
};
