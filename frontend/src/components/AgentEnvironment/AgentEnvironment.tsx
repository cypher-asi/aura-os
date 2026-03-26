import { useState, useRef, useEffect, useCallback } from "react"
import { useEnvironmentInfo } from "../../hooks/use-environment-info"
import { api } from "../../api/client"
import type { RemoteVmState } from "../../types"
import type { LifecycleAction } from "../../api/swarm"
import { useProfileStatus } from "../../stores/profile-status-store"
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
  action: LifecycleAction
  label: string
  hint?: string
  primary?: boolean
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
        { action: "restart", label: "Restart", primary: true },
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

  const [vmState, setVmState] = useState<RemoteVmState | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const agentStatus = useProfileStatus(isLocal ? agentId : undefined)

  const refreshState = useCallback(() => {
    if (!isRemote) return
    api.swarm
      .getRemoteAgentState(agentId!)
      .then((state) => setVmState(state))
      .catch(() => {})
  }, [isRemote, agentId])

  useEffect(() => {
    if (!isRemote) return
    refreshState()
    const interval = setInterval(refreshState, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [isRemote, agentId, refreshState])

  const handleAction = useCallback(
    async (action: LifecycleAction) => {
      if (!agentId || actionLoading) return
      setActionLoading(action)
      setActionError(null)
      try {
        await api.swarm.remoteAgentAction(agentId, action)
        refreshState()
      } catch (e: unknown) {
        setActionError(e instanceof Error ? e.message : "Action failed")
      } finally {
        setActionLoading(null)
      }
    },
    [agentId, actionLoading, refreshState],
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
              : agentStatus === "working" ? "running" : "idle"
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
              {(() => {
                const actions = getActionsForState(vmState.state)
                if (actions.length === 0) {
                  if (vmState.state === "provisioning" || vmState.state === "stopping") {
                    return (
                      <div className={styles.actionsRow}>
                        <span className={styles.actionsWait}>
                          {vmState.state === "provisioning" ? "Starting up…" : "Shutting down…"}
                        </span>
                      </div>
                    )
                  }
                  return null
                }
                return (
                  <div className={styles.actionsRow}>
                    {actions.map((a) => (
                      <button
                        key={a.action}
                        className={`${styles.actionBtn} ${a.primary ? styles.actionBtnPrimary : ""}`}
                        disabled={!!actionLoading}
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
