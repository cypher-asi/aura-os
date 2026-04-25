import type { RemoteVmState } from "../shared/types"
import type { DirEntry } from "./desktop"
import { apiFetch } from "./core"

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
    apiFetch<{ ok: boolean; content?: string; path?: string; error?: string }>(
      `/api/agents/${agentId}/remote_agent/read-file`,
      { method: "POST", body: JSON.stringify({ path }) },
    ),
}
