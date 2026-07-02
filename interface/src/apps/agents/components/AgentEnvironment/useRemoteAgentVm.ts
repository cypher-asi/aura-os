import { useCallback, useEffect, useState } from "react"
import { useEventStore } from "../../../../stores/event-store/index"
import { EventType } from "../../../../shared/types/aura-events"
import { api } from "../../../../api/client"
import type { RemoteVmState } from "../../../../shared/types"
import type { LifecycleAction } from "../../../../shared/api/swarm"
import {
  MAX_CONSECUTIVE_VM_POLL_FAILURES,
  PHASE_NOTICES,
  POLL_INTERVAL,
  PROVISIONING_POLL_INTERVAL,
  SETTLED_POLL_INTERVAL,
  getRemoteStateErrorMessage,
  isRecoverableRemoteStateError,
  isTerminalVmState,
  type RecoveryNotice,
} from "./helpers"

interface UseRemoteAgentVmOptions {
  isRemote: boolean
  agentId?: string
}

interface UseRemoteAgentVmResult {
  vmState: RemoteVmState | null
  remoteStateError: string | null
  remoteStateRecoverable: boolean
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
  const [remoteStateRecoverable, setRemoteStateRecoverable] = useState(true)
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
      setRemoteStateRecoverable(true)
      return state
    } catch (error) {
      const message = getRemoteStateErrorMessage(error)
      setRemoteStateError(message)
      setRemoteStateRecoverable(isRecoverableRemoteStateError(error))
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
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    // Adaptive cadence: poll quickly while the VM is provisioning so boot
    // progress feels live, then back off to the steady interval once it
    // settles. A recursive timeout (vs setInterval) lets each tick choose the
    // next delay from the freshly-observed state.
    //
    // Once the VM hits a terminal state (`error`/`stopped`) or keeps failing
    // (e.g. repeated 502s on a stuck-provisioning machine), back off hard to
    // SETTLED_POLL_INTERVAL so we stop flooding `/remote_agent/state`. The
    // loop stays alive at the slow cadence, so a recovery (which produces a
    // successful poll) resets `consecutiveFailures` and the cadence resumes.
    let consecutiveFailures = 0
    const tick = async () => {
      const state = await refreshState()
      if (cancelled) return
      consecutiveFailures = state ? 0 : consecutiveFailures + 1
      const settled =
        isTerminalVmState(state?.state) ||
        consecutiveFailures >= MAX_CONSECUTIVE_VM_POLL_FAILURES
      const next = settled
        ? SETTLED_POLL_INTERVAL
        : state?.state === "provisioning"
          ? PROVISIONING_POLL_INTERVAL
          : POLL_INTERVAL
      timer = setTimeout(tick, next)
    }
    tick()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
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
        harness_git_sha: prev?.harness_git_sha,
        isolation: prev?.isolation,
        cpu_millicores: prev?.cpu_millicores,
        memory_mb: prev?.memory_mb,
        vm_instance_type: prev?.vm_instance_type,
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
          setRemoteStateError(null)
          setRecoveryNotice({ tone: "info", message: "Submitting recovery request..." })
          setVmState((current) => ({
            state: "provisioning",
            uptime_seconds: 0,
            active_sessions: 0,
            endpoint: current?.endpoint,
            runtime_version: current?.runtime_version,
            harness_git_sha: current?.harness_git_sha,
            isolation: current?.isolation,
            cpu_millicores: current?.cpu_millicores,
            memory_mb: current?.memory_mb,
            vm_instance_type: current?.vm_instance_type,
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
    remoteStateRecoverable,
    recoveryNotice,
    pendingRecovery,
    actionLoading,
    actionError,
    handleAction,
    clearActionError,
  }
}
