import type { RemoteVmState } from "../types"
import { apiFetch } from "./core"

export interface LifecycleActionResult {
  agent_id: string
  status: string
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
}
