import styles from "./VmStatusBadge.module.css"

const STATE_MAP: Record<string, { dotClass: string; label: string }> = {
  running: { dotClass: styles.dotRunning, label: "Running" },
  idle: { dotClass: styles.dotIdle, label: "Idle" },
  provisioning: { dotClass: styles.dotProvisioning, label: "Provisioning" },
  hibernating: { dotClass: styles.dotHibernating, label: "Hibernating" },
  stopping: { dotClass: styles.dotStopping, label: "Stopping" },
  stopped: { dotClass: styles.dotStopped, label: "Stopped" },
  error: { dotClass: styles.dotError, label: "Error" },
}

interface VmStatusBadgeProps {
  state: string
}

export function VmStatusBadge({ state }: VmStatusBadgeProps) {
  const entry = STATE_MAP[state] ?? { dotClass: styles.dotStopped, label: state }

  return (
    <span className={styles.badge}>
      <span className={`${styles.dot} ${entry.dotClass}`} />
      {entry.label}
    </span>
  )
}
