import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react"
import { createPortal } from "react-dom"
import { useAvatarState } from "../../../../hooks/use-avatar-state"
import { useEnvironmentInfo } from "../../../../hooks/use-environment-info"
import styles from "./AgentEnvironment.module.css"
import { StatusCard } from "./StatusCard"
import { useRemoteAgentVm } from "./useRemoteAgentVm"
import {
  STATUS_CARD_GAP,
  STATUS_CARD_MIN_WIDTH,
  STATUS_CARD_VIEWPORT_MARGIN,
  isNodeTarget,
} from "./helpers"

interface AgentEnvironmentProps {
  machineType: "local" | "remote" | undefined
  agentId?: string
  /**
   * Resolved workspace folder for the agent (typically
   * `AgentInstance.workspace_path`, which already honors
   * `Agent.local_workspace_path` and `Project.local_workspace_path`).
   * When omitted, the popover falls back to the server process's CWD.
   */
  workspacePath?: string | null
}

export const AgentEnvironment = memo(function AgentEnvironment({ machineType, agentId, workspacePath }: AgentEnvironmentProps) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [statusCardStyle, setStatusCardStyle] = useState<CSSProperties | null>(null)
  const [showActions, setShowActions] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const statusCardRef = useRef<HTMLDivElement>(null)
  const { data } = useEnvironmentInfo()
  const isLoading = machineType === undefined
  const isLocal = machineType === "local"
  const isRemote = machineType === "remote" && !!agentId
  const avatarState = useAvatarState(agentId)

  const {
    vmState,
    remoteStateError,
    remoteStateRecoverable,
    recoveryNotice,
    pendingRecovery,
    actionLoading,
    actionError,
    handleAction,
    clearActionError,
  } = useRemoteAgentVm({ isRemote, agentId })

  const updateStatusCardPosition = useCallback(() => {
    const wrapper = wrapperRef.current
    if (!wrapper || typeof window === "undefined") return

    const rect = wrapper.getBoundingClientRect()
    const maxLeft = Math.max(
      STATUS_CARD_VIEWPORT_MARGIN,
      window.innerWidth - STATUS_CARD_MIN_WIDTH - STATUS_CARD_VIEWPORT_MARGIN,
    )
    setStatusCardStyle({
      left: Math.min(Math.max(rect.left, STATUS_CARD_VIEWPORT_MARGIN), maxLeft),
      top: Math.max(rect.top - STATUS_CARD_GAP, STATUS_CARD_VIEWPORT_MARGIN),
    })
  }, [])

  useEffect(() => {
    if (!open) {
      setStatusCardStyle(null)
      return
    }

    updateStatusCardPosition()
    window.addEventListener("resize", updateStatusCardPosition)
    window.addEventListener("scroll", updateStatusCardPosition, true)
    return () => {
      window.removeEventListener("resize", updateStatusCardPosition)
      window.removeEventListener("scroll", updateStatusCardPosition, true)
    }
  }, [open, updateStatusCardPosition])

  const handleMouseEnter = useCallback(() => {
    if (isLoading) return
    if (!pinned) setOpen(true)
  }, [isLoading, pinned])

  const handleMouseLeave = useCallback((event: ReactMouseEvent) => {
    const nextTarget = event.relatedTarget
    if (isNodeTarget(nextTarget) && statusCardRef.current?.contains(nextTarget)) return
    if (!pinned) setOpen(false)
  }, [pinned])

  const handleStatusCardMouseLeave = useCallback((event: ReactMouseEvent) => {
    const nextTarget = event.relatedTarget
    if (isNodeTarget(nextTarget) && wrapperRef.current?.contains(nextTarget)) return
    if (!pinned) setOpen(false)
  }, [pinned])

  const handleClick = useCallback(() => {
    if (isLoading) return
    if (pinned) {
      setPinned(false)
      setOpen(false)
    } else {
      setPinned(true)
      setOpen(true)
    }
    clearActionError()
  }, [isLoading, pinned, clearActionError])

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      const insideWrapper = wrapperRef.current?.contains(target)
      const insideStatusCard = statusCardRef.current?.contains(target)
      if (!insideWrapper && !insideStatusCard) {
        setOpen(false)
        setPinned(false)
      }
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [open])

  const remoteStatus = vmState?.state ?? (remoteStateError ? "error" : "running")
  const remoteErrorMessage = remoteStateError ?? vmState?.error_message
  const statusCard = open && typeof document !== "undefined"
    ? createPortal(
        <StatusCard
          ref={statusCardRef}
          isLocal={isLocal}
          isRemote={isRemote}
          agentId={agentId}
          statusCardStyle={statusCardStyle}
          handleMouseEnter={handleMouseEnter}
          handleStatusCardMouseLeave={handleStatusCardMouseLeave}
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
          envInfo={data}
          workspacePath={workspacePath}
        />,
        document.body,
      )
    : null

  if (isLoading) {
    // Render an inert placeholder that occupies the same width as the loaded
    // indicator so siblings on the bottom bar don't shift while the agent
    // metadata query is in flight.
    return (
      <div ref={wrapperRef} className={styles.wrapper}>
        <span
          className={styles.indicator}
          data-loading="true"
          aria-hidden="true"
        >
          <span className={styles.dot} data-status="idle" />
          Remote
        </span>
      </div>
    )
  }

  return (
    <>
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
      </div>
      {statusCard}
    </>
  )
})
