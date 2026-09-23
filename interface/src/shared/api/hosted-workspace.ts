import type { ProjectId } from "../types";
import type { DirEntry } from "./desktop";
import { apiFetch } from "./core";
import { activeDesktopEnvironmentId } from "./desktop-relay";
import {
  encodeUtf8Base64,
  type WorkspaceFileReadResult,
  type WorkspaceFileWriteResult,
} from "./workspace-files";

export interface HostedWorkspaceTarget {
  projectId: ProjectId;
  agentInstanceId: string;
  /** Route local workspace reads to the paired desktop when present. */
  desktopEnvironmentId?: string;
}

function workspaceBase({ projectId, agentInstanceId }: HostedWorkspaceTarget) {
  return `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentInstanceId)}/workspace`;
}

function relayHeaders(target: HostedWorkspaceTarget): Record<string, string> {
  const environmentId = target.desktopEnvironmentId ?? activeDesktopEnvironmentId();
  return environmentId ? { "X-Aura-Desktop-Environment": environmentId } : {};
}

export const hostedWorkspaceApi = {
  listFiles: (target: HostedWorkspaceTarget) =>
    apiFetch<{ ok: boolean; entries?: DirEntry[]; error?: string }>(
      `${workspaceBase(target)}/files`,
      { headers: relayHeaders(target) },
    ),

  readFile: (target: HostedWorkspaceTarget, path: string) =>
    apiFetch<WorkspaceFileReadResult>(
      `${workspaceBase(target)}/read-file?path=${encodeURIComponent(path)}`,
      { headers: relayHeaders(target) },
    ),

  writeFile: (
    target: HostedWorkspaceTarget,
    path: string,
    content: string,
    expectedRevision: string,
  ) =>
    apiFetch<WorkspaceFileWriteResult>(`${workspaceBase(target)}/write-file`, {
      method: "PUT",
      headers: relayHeaders(target),
      body: JSON.stringify({
        path,
        content_base64: encodeUtf8Base64(content),
        expected_revision: expectedRevision,
      }),
    }),
};
