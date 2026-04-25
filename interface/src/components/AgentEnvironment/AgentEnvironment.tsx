import { useState, useRef, useEffect, useCallback } from "react"
import { useEnvironmentInfo } from "../../hooks/use-environment-info"
import { useAvatarState } from "../../hooks/use-avatar-state"
import { useEventStore } from "../../stores/event-store/index"
import { EventType } from "../../shared/types/aura-events"
import { api } from "../../api/client"
import { ApiClientError } from "../../shared/api/core"
import type { RemoteVmState } from "../../shared/types"
import type { LifecycleAction } from "../../shared/api/swarm"
import { getApiErrorMessage } from "../../shared/utils/api-errors"
import { VmStatusBadge } from "../VmStatusBadge"
import styles from "./AgentEnvironment.module.css"

interface AgentEnvironmentProps {
  machineType: "local" | "remote"
  agentId?: string
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`
  const m = Math.floor(seconds / 60) % 60
  const h = Math.floor(seconds / 3600)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

interface ActionDef {
  action: LifecycleAction | "recover"
  label: string
  hint?: string
  primary?: boolean
  danger?: boolean
}

interface RecoveryNotice {
  tone: "info" | "warning" | "error" | "success"
  message: string
}

const PHASE_NOTICES: Record<string, RecoveryNotice> = {
  deleting: { tone: "info", message: "Deleting old machine..." },
  provisioning: { tone: "info", message: "Provisioning new machine..." },
  waiting_for_ready: { tone: "info", message: "Waiting for machine to come online..." },
}

function getRemoteStateErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 404) {
      return "Remote machine state is unavailable. This agent may no longer have an attached remote machine."
    }
    if (error.status === 401) {
      return "Your session expired while loading this remote agent. Sign in again and retry."
    }
  }

  return getApiErrorMessage(error)
}

function getActionsForState(state: string): ActionDef[] {
  switch (state) {
    case "running":
    case "idle":
      return [
        { action: "hibernate", label: "Hibernate", hint: "stops billing", primary: true },
        { action: "restart", label: "Restart" },
        { action: "stop", label: "Stop" },
      ]
    case "hibernating":
      return [{ action: "wake", label: "Wake", primary: true }]
    case "stopped":
      return [{ action: "start", label: "Start", primary: true }]
    case "error":
      return [
        { action: "recover", label: "Recovery", primary: true, danger: true },
        { action: "stop", label: "Stop" },
      ]
    default:
      return []
  }
}

const POLL_INTERVAL = 15_000

export function AgentEnvironment({ machineType, agentId }: AgentEnvironmentProps) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const { data } = useEnvironmentInfo()
  const isLocal = machineType === "local"
  const isRemote = machineType === "remote" && !!agentId
  const subscribe = useEventStore((s) => s.subscribe)

  const [vmState, setVmState] = useState<RemoteVmState | null>(null)
  const [remoteStateError, setRemoteStateError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingRecovery, setPendingRecovery] = useState(false)
  const [recoveryNotice, setRecoveryNotice] = useState<RecoveryNotice | null>(null)
  const [showActions, setShowActions] = useState(false)
  const avatarState = useAvatarState(agentId)

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

  const handleMouseEnter = useCallback(() => {
    if (!pinned) setOpen(true)
  }, [pinned])
  const handleMouseLeave = useCallback(() => {
    if (!pinned) setOpen(false)
  }, [pinned])
  const handleClick = useCallback(() => {
    if (pinned) {
      setPinned(false)
      setOpen(false)
    } else {
      setPinned(true)
      setOpen(true)
    }
    setActionError(null)
  }, [pinned])

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
        setPinned(false)
      }
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [open])

  const remoteStatus = vmState?.state ?? (remoteStateError ? "error" : "running")
  const remoteErrorMessage = remoteStateError ?? vmState?.error_message

  return (
    <div
      ref={wrapperRef}
      className={styles.wrapper}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span className={styles.indicator} onClick={handleClick} role="button" tabIndex={0}>
        <span
          className={styles.dot}
          data-status={
            isRemote
              ? remoteStatus
              : (avatarState.isLocal ? "local" : (avatarState.status ?? "idle"))
          }
        />
        {isLocal ? "Local" : "Remote"}
      </span>

      {open && (
        <div className={styles.statusCard}>
          {isRemote ? (
            <>
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>Status</span>
                <span className={styles.statusValue}>
                  <VmStatusBadge state={remoteStatus} />
                </span>
              </div>
              {remoteStateError && (
                <div className={`${styles.recoveryNotice} ${styles.recoveryNoticeError}`}>
                  <span className={styles.recoveryNoticeLabel}>Remote state</span>
                  <span className={styles.recoveryNoticeMessage}>{remoteStateError}</span>
                </div>
              )}
              {vmState?.endpoint && (
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>IP</span>
                  <span className={styles.statusValue}>{vmState.endpoint}</span>
                </div>
              )}
              {vmState && (
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>Uptime</span>
                  <span className={styles.statusValue}>{formatUptime(vmState.uptime_seconds)}</span>
                </div>
              )}
              {vmState && (
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>Sessions</span>
                  <span className={styles.statusValue}>{vmState.active_sessions}</span>
                </div>
              )}
              {vmState?.runtime_version && (
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>Runtime</span>
                  <span className={styles.statusValue}>{vmState.runtime_version}</span>
                </div>
              )}
              {vmState && (vmState.cpu_millicores || vmState.memory_mb) && (
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>Resources</span>
                  <span className={styles.statusValue}>
                    {vmState.cpu_millicores ? `${vmState.cpu_millicores}m CPU` : ""}
                    {vmState.cpu_millicores && vmState.memory_mb ? " · " : ""}
                    {vmState.memory_mb ? `${vmState.memory_mb}MB RAM` : ""}
                  </span>
                </div>
              )}
              {vmState?.isolation && (
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>Isolation</span>
                  <span className={styles.statusValue}>
                    {vmState.isolation === "micro_vm" ? "MicroVM" : "Container"}
                  </span>
                </div>
              )}
              {vmState?.agent_id && (
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>Agent ID</span>
                  <span className={styles.statusValue}>{vmState.agent_id.slice(0, 12)}…</span>
                </div>
              )}
              {remoteErrorMessage && !remoteStateError && (
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>Error</span>
                  <span className={styles.statusValue}>{remoteErrorMessage}</span>
                </div>
              )}
              {recoveryNotice && !remoteStateError && (
                <div className={`${styles.recoveryNotice} ${styles[`recoveryNotice${recoveryNotice.tone[0].toUpperCase()}${recoveryNotice.tone.slice(1)}`]}`}>
                  <span className={styles.recoveryNoticeLabel}>Recovery</span>
                  <span className={styles.recoveryNoticeMessage}>{recoveryNotice.message}</span>
                </div>
              )}
              {!remoteStateError && vmState && (() => {
                const actions = getActionsForState(vmState.state)
                if (actions.length === 0) {
                  if (vmState.state === "provisioning" || vmState.state === "stopping") {
                    return (
                      <div className={styles.actionsRow}>
                        <span className={styles.actionsWait}>
                          {vmState.state === "provisioning"
                            ? (pendingRecovery ? "Recovery requested. Starting up..." : "Starting up…")
                            : "Shutting down…"}
                        </span>
                      </div>
                    )
                  }
                  return null
                }
                return (
                  <>
                    <div className={styles.actionsRow}>
                      <button
                        className={styles.manageBtn}
                        onClick={(e) => { e.stopPropagation(); setShowActions(v => !v) }}
                      >
                        {showActions ? "Hide" : "Manage"}
                      </button>
                    </div>
                    {showActions && (
                      <div className={styles.actionsRow}>
                        {actions.map((a) => (
                          <button
                            key={a.action}
                            className={[
                              styles.actionBtn,
                              a.primary ? styles.actionBtnPrimary : "",
                              a.danger ? styles.actionBtnDanger : "",
                            ].filter(Boolean).join(" ")}
                            data-variant={a.danger ? "danger" : undefined}
                            disabled={!!actionLoading || pendingRecovery}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleAction(a.action)
                            }}
                          >
                            {actionLoading === a.action ? "…" : a.label}
                            {a.hint && !actionLoading && (
                              <span className={styles.actionHint}>{a.hint}</span>
                            )}
                          </button>
                        ))}
                        {actionError && (
                          <span className={styles.actionError}>{actionError}</span>
                        )}
                      </div>
                    )}
                  </>
                )
              })()}
            </>
          ) : (
            <>
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>Status</span>
                <span className={styles.statusValue}>{isLocal ? "Running locally" : "Remote agent"}</span>
              </div>
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>IP</span>
                <span className={styles.statusValue}>{data?.ip ?? "—"}</span>
              </div>
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>File Path</span>
                <span className={styles.statusValue}>{data?.cwd ?? "—"}</span>
              </div>
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>OS</span>
                <span className={styles.statusValue}>
                  {data ? `${data.os} (${data.architecture})` : "—"}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
