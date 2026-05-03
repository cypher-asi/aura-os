import { useCallback, useEffect, useState } from "react"
import { useEventStore } from "../../../../stores/event-store/index"
import { EventType } from "../../../../shared/types/aura-events"
import { api } from "../../../../api/client"
import type { RemoteVmState } from "../../../../shared/types"
import type { LifecycleAction } from "../../../../shared/api/swarm"
import {
  PHASE_NOTICES,
  POLL_INTERVAL,
  getRemoteStateErrorMessage,
  type RecoveryNotice,
} from "./helpers"

interface UseRemoteAgentVmOptions {
  isRemote: boolean
  agentId?: string
}

interface UseRemoteAgentVmResult {
  vmState: RemoteVmState | null
  remoteStateError: string | null
  recoveryNotice: RecoveryNotice | null
  pendingRecovery: boolean
  actionLoading: string | null
  actionError: string | null
  handleAction: (action: LifecycleAction | "recover") => Promise<void>
  clearActionError: () => void
}

export function useRemoteAgentVm({
  isRemote,
  agentId,
}: UseRemoteAgentVmOptions): UseRemoteAgentVmResult {
  const subscribe = useEventStore((s) => s.subscribe)

  const [vmState, setVmState] = useState<RemoteVmState | null>(null)
  const [remoteStateError, setRemoteStateError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingRecovery, setPendingRecovery] = useState(false)
  const [recoveryNotice, setRecoveryNotice] = useState<RecoveryNotice | null>(null)

  const refreshState = useCallback(async () => {
    if (!isRemote || !agentId) return null
    try {
      const state = await api.swarm.getRemoteAgentState(agentId)
      setVmState(state)
      setRemoteStateError(null)
      return state
    } catch (error) {
      const message = getRemoteStateErrorMessage(error)
      setRemoteStateError(message)
      setVmState((current) =>
        current
          ? {
              ...current,
              state: "error",
              error_message: message,
            }
          : null,
      )
      return null
    }
  }, [isRemote, agentId])

  useEffect(() => {
    if (!isRemote) return
    refreshState()
    const interval = setInterval(refreshState, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [isRemote, agentId, refreshState])

  useEffect(() => {
    if (!isRemote || !agentId) return

    const unsubscribe = subscribe(EventType.RemoteAgentStateChanged, (event) => {
      const c = event.content
      if (c?.agent_id !== agentId) return

      if (c.action === "recover" && c.phase) {
        if (c.phase === "error") {
          setPendingRecovery(false)
          setRecoveryNotice({
            tone: "error",
            message: c.error_message ?? "Recovery failed.",
          })
          return
        }

        if (c.phase === "ready") {
          setPendingRecovery(false)
          setRecoveryNotice(null)
          refreshState()
          return
        }

        const notice = PHASE_NOTICES[c.phase]
        if (notice) {
          setRecoveryNotice(notice)
        }
        return
      }

      setVmState((prev) => ({
        state: c.state,
        uptime_seconds: c.uptime_seconds ?? prev?.uptime_seconds ?? 0,
        active_sessions: c.active_sessions ?? prev?.active_sessions ?? 0,
        error_message: c.error_message,
        endpoint: prev?.endpoint,
        runtime_version: prev?.runtime_version,
        isolation: prev?.isolation,
        cpu_millicores: prev?.cpu_millicores,
        memory_mb: prev?.memory_mb,
        agent_id: prev?.agent_id ?? agentId,
      }))
    })

    return unsubscribe
  }, [isRemote, agentId, subscribe, refreshState])

  const handleAction = useCallback(
    async (action: LifecycleAction | "recover") => {
      if (!agentId || actionLoading || pendingRecovery) return
      setActionLoading(action)
      setActionError(null)
      try {
        if (action === "recover") {
          setPendingRecovery(true)
          setRecoveryNotice({ tone: "info", message: "Submitting recovery request..." })
          setVmState((current) => ({
            state: "provisioning",
            uptime_seconds: 0,
            active_sessions: 0,
            endpoint: current?.endpoint,
            runtime_version: current?.runtime_version,
            isolation: current?.isolation,
            cpu_millicores: current?.cpu_millicores,
            memory_mb: current?.memory_mb,
            agent_id: current?.agent_id ?? agentId,
            error_message: undefined,
          }))

          const result = await api.swarm.recoverRemoteAgent(agentId)

          if (result.status === "running" || result.status === "idle") {
            setPendingRecovery(false)
            setRecoveryNotice(null)
            await refreshState()
          }
        } else {
          setRecoveryNotice(null)
          await api.swarm.remoteAgentAction(agentId, action)
          await refreshState()
        }
      } catch (e: unknown) {
        setPendingRecovery(false)
        const message = e instanceof Error ? e.message : "Action failed"
        setActionError(message)
        if (action === "recover") {
          setRecoveryNotice({ tone: "error", message })
        }
      } finally {
        setActionLoading(null)
      }
    },
    [agentId, actionLoading, pendingRecovery, refreshState],
  )

  const clearActionError = useCallback(() => {
    setActionError(null)
  }, [])

  return {
    vmState,
    remoteStateError,
    recoveryNotice,
    pendingRecovery,
    actionLoading,
    actionError,
    handleAction,
    clearActionError,
  }
}
