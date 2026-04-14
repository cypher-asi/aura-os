import { useState, useRef, useEffect, useCallback } from "react"
import { useEnvironmentInfo } from "../../hooks/use-environment-info"
import { useAvatarState } from "../../hooks/use-avatar-state"
import { api } from "../../api/client"
import type { RemoteVmState } from "../../types"
import type { LifecycleAction } from "../../api/swarm"
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
const RECOVERY_FOLLOWUP_DELAY_MS = 2_000
const RECOVERY_FOLLOWUP_ATTEMPTS = 3

export function AgentEnvironment({ machineType, agentId }: AgentEnvironmentProps) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const recoveryRefreshTimeoutRef = useRef<number | null>(null)
  const { data } = useEnvironmentInfo()
  const isLocal = machineType === "local"
  const isRemote = machineType === "remote" && !!agentId

  const [vmState, setVmState] = useState<RemoteVmState | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingRecovery, setPendingRecovery] = useState(false)
  const [recoveryNotice, setRecoveryNotice] = useState<RecoveryNotice | null>(null)
  const [showActions, setShowActions] = useState(false)
  const avatarState = useAvatarState(agentId)

  const clearRecoveryTimeout = useCallback(() => {
    if (recoveryRefreshTimeoutRef.current !== null) {
      window.clearTimeout(recoveryRefreshTimeoutRef.current)
      recoveryRefreshTimeoutRef.current = null
    }
  }, [])

  const refreshState = useCallback(async () => {
    if (!isRemote) return null
    try {
      const state = await api.swarm.getRemoteAgentState(agentId!)
      setVmState(state)
      return state
    } catch {
      return null
    }
  }, [isRemote, agentId])

  useEffect(() => {
    if (!isRemote) return
    refreshState()
    const interval = setInterval(refreshState, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [isRemote, agentId, refreshState])

  useEffect(() => () => clearRecoveryTimeout(), [clearRecoveryTimeout])

  const scheduleRecoveryFollowup = useCallback((remainingChecks: number) => {
    clearRecoveryTimeout()
    recoveryRefreshTimeoutRef.current = window.setTimeout(async () => {
      const nextState = await refreshState()

      if (!nextState) {
        setPendingRecovery(false)
        setRecoveryNotice({
          tone: "warning",
          message: "Recovery was requested. Waiting for the latest machine status...",
        })
        return
      }

      if (nextState.state === "error") {
        setPendingRecovery(false)
        setRecoveryNotice({
          tone: "error",
          message: nextState.error_message
            ? `Recovery request succeeded, but the machine returned Error: ${nextState.error_message}`
            : "Recovery request succeeded, but the machine is still reporting Error.",
        })
        return
      }

      if (nextState.state === "running" || nextState.state === "idle") {
        setPendingRecovery(false)
        setRecoveryNotice({
          tone: "success",
          message: "Recovery completed. The machine is available again.",
        })
        return
      }

      if (remainingChecks > 1) {
        setRecoveryNotice({
          tone: "info",
          message: "Recovery is still provisioning. Waiting for the machine to come online...",
        })
        scheduleRecoveryFollowup(remainingChecks - 1)
        return
      }

      setPendingRecovery(false)
      setRecoveryNotice({
        tone: "warning",
        message: "Recovery is still provisioning. Check back in a few seconds.",
      })
    }, RECOVERY_FOLLOWUP_DELAY_MS)
  }, [clearRecoveryTimeout, refreshState])

  const handleAction = useCallback(
    async (action: LifecycleAction | "recover") => {
      if (!agentId || actionLoading || pendingRecovery) return
      setActionLoading(action)
      setActionError(null)
      try {
        if (action === "recover") {
          setRecoveryNotice({ tone: "info", message: "Submitting recovery request..." })
          const result = await api.swarm.recoverRemoteAgent(agentId)
          if (result.vm_id_changed === false) {
            setPendingRecovery(false)
            setRecoveryNotice({
              tone: "warning",
              message:
                result.message ??
                "Swarm accepted the recovery request but kept the same machine mapping.",
            })
            await refreshState()
            return
          }

          setPendingRecovery(true)
          setRecoveryNotice({
            tone: "info",
            message: "Recovery requested. Starting up...",
          })
          setVmState((current) => ({
            state: result.status || "provisioning",
            uptime_seconds: current?.uptime_seconds ?? 0,
            active_sessions: current?.active_sessions ?? 0,
            endpoint: current?.endpoint,
            runtime_version: current?.runtime_version,
            isolation: current?.isolation,
            cpu_millicores: current?.cpu_millicores,
            memory_mb: current?.memory_mb,
            agent_id: current?.agent_id ?? agentId,
            error_message: undefined,
          }))
          if (result.status === "running" || result.status === "idle") {
            setPendingRecovery(false)
            setRecoveryNotice({
              tone: "success",
              message: "Recovery completed. The machine is available again.",
            })
            await refreshState()
            return
          }

          scheduleRecoveryFollowup(RECOVERY_FOLLOWUP_ATTEMPTS)
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
    [agentId, actionLoading, pendingRecovery, refreshState, scheduleRecoveryFollowup],
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
              ? (vmState?.state ?? "running")
              : (avatarState.isLocal ? "local" : (avatarState.status ?? "idle"))
          }
        />
        {isLocal ? "Local" : "Remote"}
      </span>

      {open && (
        <div className={styles.statusCard}>
          {isRemote && vmState ? (
            <>
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>Status</span>
                <span className={styles.statusValue}>
                  <VmStatusBadge state={vmState.state} />
                </span>
              </div>
              {vmState.endpoint && (
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>IP</span>
                  <span className={styles.statusValue}>{vmState.endpoint}</span>
                </div>
              )}
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>Uptime</span>
                <span className={styles.statusValue}>{formatUptime(vmState.uptime_seconds)}</span>
              </div>
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>Sessions</span>
                <span className={styles.statusValue}>{vmState.active_sessions}</span>
              </div>
              {vmState.runtime_version && (
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>Runtime</span>
                  <span className={styles.statusValue}>{vmState.runtime_version}</span>
                </div>
              )}
              {(vmState.cpu_millicores || vmState.memory_mb) && (
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>Resources</span>
                  <span className={styles.statusValue}>
                    {vmState.cpu_millicores ? `${vmState.cpu_millicores}m CPU` : ""}
                    {vmState.cpu_millicores && vmState.memory_mb ? " · " : ""}
                    {vmState.memory_mb ? `${vmState.memory_mb}MB RAM` : ""}
                  </span>
                </div>
              )}
              {vmState.isolation && (
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>Isolation</span>
                  <span className={styles.statusValue}>
                    {vmState.isolation === "micro_vm" ? "MicroVM" : "Container"}
                  </span>
                </div>
              )}
              {vmState.agent_id && (
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>Agent ID</span>
                  <span className={styles.statusValue}>{vmState.agent_id.slice(0, 12)}…</span>
                </div>
              )}
              {vmState.error_message && (
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>Error</span>
                  <span className={styles.statusValue}>{vmState.error_message}</span>
                </div>
              )}
              {recoveryNotice && (
                <div className={`${styles.recoveryNotice} ${styles[`recoveryNotice${recoveryNotice.tone[0].toUpperCase()}${recoveryNotice.tone.slice(1)}`]}`}>
                  <span className={styles.recoveryNoticeLabel}>Recovery</span>
                  <span className={styles.recoveryNoticeMessage}>{recoveryNotice.message}</span>
                </div>
              )}
              {(() => {
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
