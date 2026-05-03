import {
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
  machineType: "local" | "remote"
  agentId?: string
}

export function AgentEnvironment({ machineType, agentId }: AgentEnvironmentProps) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [statusCardStyle, setStatusCardStyle] = useState<CSSProperties | null>(null)
  const [showActions, setShowActions] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const statusCardRef = useRef<HTMLDivElement>(null)
  const { data } = useEnvironmentInfo()
  const isLocal = machineType === "local"
  const isRemote = machineType === "remote" && !!agentId
  const avatarState = useAvatarState(agentId)

  const {
    vmState,
    remoteStateError,
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
    if (!pinned) setOpen(true)
  }, [pinned])

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
    if (pinned) {
      setPinned(false)
      setOpen(false)
    } else {
      setPinned(true)
      setOpen(true)
    }
    clearActionError()
  }, [pinned, clearActionError])

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
          statusCardStyle={statusCardStyle}
          handleMouseEnter={handleMouseEnter}
          handleStatusCardMouseLeave={handleStatusCardMouseLeave}
          vmState={vmState}
          remoteStateError={remoteStateError}
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
        />,
        document.body,
      )
    : null

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
}
