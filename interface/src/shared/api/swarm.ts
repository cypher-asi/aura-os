import type { RemoteVmLogs, RemoteVmState } from "../types"
import type { DirEntry } from "./desktop"
import { apiFetch } from "./core"
import {
  encodeUtf8Base64,
  type WorkspaceFileReadResult,
  type WorkspaceFileWriteResult,
} from "./workspace-files"

export interface LifecycleActionResult {
  agent_id: string
  status: string
}

export interface RecoveryActionResult {
  agent_id: string
  status: string
  previous_vm_id?: string | null
  vm_id?: string | null
}

export type LifecycleAction = "hibernate" | "stop" | "restart" | "wake" | "start"

export const swarmApi = {
  getRemoteAgentState: (agentId: string) =>
    apiFetch<RemoteVmState>(`/api/agents/${agentId}/remote_agent/state`),

  getRemoteAgentLogs: (agentId: string, tail?: number) =>
    apiFetch<RemoteVmLogs>(
      `/api/agents/${agentId}/remote_agent/logs${tail ? `?tail=${tail}` : ""}`,
    ),

  remoteAgentAction: (agentId: string, action: LifecycleAction) =>
    apiFetch<LifecycleActionResult>(
      `/api/agents/${agentId}/remote_agent/${action}`,
      { method: "POST" },
    ),

  recoverRemoteAgent: (agentId: string) =>
    apiFetch<RecoveryActionResult>(
      `/api/agents/${agentId}/remote_agent/recover`,
      { method: "POST" },
    ),

  listRemoteDirectory: (agentId: string, path: string) =>
    apiFetch<{ ok: boolean; entries?: DirEntry[]; error?: string }>(
      `/api/agents/${agentId}/remote_agent/files`,
      { method: "POST", body: JSON.stringify({ path }) },
    ),

  readRemoteFile: (agentId: string, path: string) =>
    apiFetch<WorkspaceFileReadResult>(
      `/api/agents/${agentId}/remote_agent/read-file`,
      { method: "POST", body: JSON.stringify({ path }) },
    ),

  writeRemoteFile: (
    agentId: string,
    path: string,
    content: string,
    expectedRevision: string,
  ) =>
    apiFetch<WorkspaceFileWriteResult>(
      `/api/agents/${agentId}/remote_agent/write-file`,
      {
        method: "PUT",
        body: JSON.stringify({
          path,
          content_base64: encodeUtf8Base64(content),
          expected_revision: expectedRevision,
        }),
      },
    ),
}
