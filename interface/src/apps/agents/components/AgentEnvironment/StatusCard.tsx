import {
  forwardRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from "react"
import type { RemoteVmState } from "../../../../shared/types"
import type { LifecycleAction } from "../../../../shared/api/swarm"
import { VmStatusBadge } from "../../../../components/VmStatusBadge"
import { ReportBugButton } from "../../../../components/ReportBugButton"
import { RemoteLogsPanel } from "../../../../components/RemoteLogsPanel"
import styles from "./AgentEnvironment.module.css"
import {
  formatUptime,
  getActionsForState,
  type RecoveryNotice,
} from "./helpers"

/** GitHub repo the deployed harness build is sourced from. */
const HARNESS_REPO_URL = "https://github.com/cypher-asi/aura-harness"

interface StatusCardProps {
  isLocal: boolean
  isRemote: boolean
  agentId?: string
  statusCardStyle: CSSProperties | null
  handleMouseEnter: () => void
  handleStatusCardMouseLeave: (event: ReactMouseEvent) => void
  vmState: RemoteVmState | null
  remoteStateError: string | null
  remoteStateRecoverable: boolean
  remoteErrorMessage: string | undefined
  remoteStatus: string
  recoveryNotice: RecoveryNotice | null
  pendingRecovery: boolean
  actionLoading: string | null
  actionError: string | null
  showActions: boolean
  setShowActions: Dispatch<SetStateAction<boolean>>
  handleAction: (action: LifecycleAction | "recover") => void
  envInfo: { os: string; architecture: string; ip: string; cwd: string } | null | undefined
  workspacePath?: string | null
}

interface RemoteActionsProps {
  vmState: RemoteVmState
  pendingRecovery: boolean
  actionLoading: string | null
  actionError: string | null
  showActions: boolean
  setShowActions: Dispatch<SetStateAction<boolean>>
  handleAction: (action: LifecycleAction | "recover") => void
}

function RemoteActions({
  vmState,
  pendingRecovery,
  actionLoading,
  actionError,
  showActions,
  setShowActions,
  handleAction,
}: RemoteActionsProps) {
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
}

interface RemoteStatusContentProps {
  agentId?: string
  vmState: RemoteVmState | null
  remoteStateError: string | null
  remoteStateRecoverable: boolean
  remoteErrorMessage: string | undefined
  remoteStatus: string
  recoveryNotice: RecoveryNotice | null
  pendingRecovery: boolean
  actionLoading: string | null
  actionError: string | null
  showActions: boolean
  setShowActions: Dispatch<SetStateAction<boolean>>
  handleAction: (action: LifecycleAction | "recover") => void
}

function RemoteStatusContent({
  agentId,
  vmState,
  remoteStateError,
  remoteStateRecoverable,
  remoteErrorMessage,
  remoteStatus,
  recoveryNotice,
  pendingRecovery,
  actionLoading,
  actionError,
  showActions,
  setShowActions,
  handleAction,
}: RemoteStatusContentProps) {
  const hasRemoteError = !!remoteStateError || !!remoteErrorMessage
  const [showLogs, setShowLogs] = useState(false)
  return (
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
      {vmState?.harness_git_sha && (
        <div className={styles.statusRow}>
          <span className={styles.statusLabel}>Harness</span>
          <span className={styles.statusValue}>
            <a
              className={styles.commitLink}
              href={`${HARNESS_REPO_URL}/commit/${vmState.harness_git_sha}`}
              target="_blank"
              rel="noopener noreferrer"
              title={vmState.harness_git_sha}
              onClick={(e) => e.stopPropagation()}
            >
              {vmState.harness_git_sha.slice(0, 7)}
            </a>
          </span>
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
          <span
            className={`${styles.statusValue} ${styles.statusValueTruncate}`}
            title={remoteErrorMessage}
          >
            {remoteErrorMessage}
          </span>
        </div>
      )}
      {recoveryNotice && !remoteStateError && (
        <div className={`${styles.recoveryNotice} ${styles[`recoveryNotice${recoveryNotice.tone[0].toUpperCase()}${recoveryNotice.tone.slice(1)}`]}`}>
          <span className={styles.recoveryNoticeLabel}>Recovery</span>
          <span className={styles.recoveryNoticeMessage}>{recoveryNotice.message}</span>
        </div>
      )}
      {!remoteStateError && vmState && (
        <RemoteActions
          vmState={vmState}
          pendingRecovery={pendingRecovery}
          actionLoading={actionLoading}
          actionError={actionError}
          showActions={showActions}
          setShowActions={setShowActions}
          handleAction={handleAction}
        />
      )}
      {!remoteStateError && agentId && (
        <>
          <div className={styles.actionsRow}>
            <button
              className={styles.manageBtn}
              onClick={(e) => { e.stopPropagation(); setShowLogs(v => !v) }}
            >
              {showLogs ? "Hide logs" : "Logs"}
            </button>
          </div>
          {showLogs && <RemoteLogsPanel agentId={agentId} />}
        </>
      )}
      {hasRemoteError && (
        <div className={styles.actionsRow}>
          {remoteStateError && remoteStateRecoverable && (
            <button
              className={[styles.actionBtn, styles.actionBtnPrimary, styles.actionBtnDanger].join(" ")}
              data-variant="danger"
              disabled={!!actionLoading || pendingRecovery}
              onClick={(e) => {
                e.stopPropagation()
                handleAction("recover")
              }}
            >
              {actionLoading === "recover" || pendingRecovery ? "…" : "Recovery"}
            </button>
          )}
          <ReportBugButton
            agentId={agentId}
            compact
            titleSuffix="remote agent error"
          />
        </div>
      )}
    </>
  )
}

interface LocalStatusContentProps {
  isLocal: boolean
  envInfo: { os: string; architecture: string; ip: string; cwd: string } | null | undefined
  workspacePath?: string | null
}

function LocalStatusContent({ isLocal, envInfo, workspacePath }: LocalStatusContentProps) {
  const displayWorkspace = workspacePath ?? envInfo?.cwd ?? "—"
  return (
    <>
      <div className={styles.statusRow}>
        <span className={styles.statusLabel}>Status</span>
        <span className={styles.statusValue}>{isLocal ? "Running locally" : "Remote agent"}</span>
      </div>
      <div className={styles.statusRow}>
        <span className={styles.statusLabel}>IP</span>
        <span className={styles.statusValue}>{envInfo?.ip ?? "—"}</span>
      </div>
      <div className={styles.statusRow}>
        <span className={styles.statusLabel}>Workspace Folder</span>
        <span className={styles.statusValue}>{displayWorkspace}</span>
      </div>
      <div className={styles.statusRow}>
        <span className={styles.statusLabel}>OS</span>
        <span className={styles.statusValue}>
          {envInfo ? `${envInfo.os} (${envInfo.architecture})` : "—"}
        </span>
      </div>
    </>
  )
}

export const StatusCard = forwardRef<HTMLDivElement, StatusCardProps>(function StatusCard(
  {
    isLocal,
    isRemote,
    agentId,
    statusCardStyle,
    handleMouseEnter,
    handleStatusCardMouseLeave,
    vmState,
    remoteStateError,
    remoteStateRecoverable,
    remoteErrorMessage,
    remoteStatus,
    recoveryNotice,
    pendingRecovery,
    actionLoading,
    actionError,
    showActions,
    setShowActions,
    handleAction,
    envInfo,
    workspacePath,
  },
  ref,
) {
  return (
    <div
      ref={ref}
      className={styles.statusCard}
      style={statusCardStyle ?? undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleStatusCardMouseLeave}
    >
      {isRemote ? (
        <RemoteStatusContent
          agentId={agentId}
          vmState={vmState}
          remoteStateError={remoteStateError}
          remoteStateRecoverable={remoteStateRecoverable}
          remoteErrorMessage={remoteErrorMessage}
          remoteStatus={remoteStatus}
          recoveryNotice={recoveryNotice}
          pendingRecovery={pendingRecovery}
          actionLoading={actionLoading}
          actionError={actionError}
          showActions={showActions}
          setShowActions={setShowActions}
          handleAction={handleAction}
        />
      ) : (
        <LocalStatusContent isLocal={isLocal} envInfo={envInfo} workspacePath={workspacePath} />
      )}
    </div>
  )
})
