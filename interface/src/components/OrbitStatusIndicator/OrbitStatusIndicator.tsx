import { useState, useRef, useEffect, useCallback } from "react"
import { FolderGit2 } from "lucide-react"
import type { Project } from "../../types"
import { usePushStuck } from "../../stores/event-store/event-store"
import styles from "./OrbitStatusIndicator.module.css"

interface OrbitStatusIndicatorProps {
  project: Project | undefined
}

function resolveOrbitUrl(project: Project): string | null {
  const owner = project.orbit_owner?.trim()
  const repo = project.orbit_repo?.trim()
  if (!owner || !repo) return null

  const base = (project.orbit_base_url?.trim() || "").replace(/\/+$/, "")
  if (base) return `${base}/${owner}/${repo}.git`
  return `${owner}/${repo}`
}

/** Mirror of `GitStepItem`'s cooldown formatter; kept local so this
 *  component doesn't pull the rest of the git-step rendering surface
 *  in. If a third call site appears, lift both to a shared util. */
function formatCooldown(secs: number): string {
  if (secs < 60) return `${Math.max(1, Math.floor(secs))}s`
  return `${Math.floor(secs / 60)}m`
}

export function OrbitStatusIndicator({ project }: OrbitStatusIndicatorProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const isConnected = !!(project?.orbit_owner?.trim() && project?.orbit_repo?.trim())
  const orbitUrl = project ? resolveOrbitUrl(project) : null
  const repoLabel = project && isConnected
    ? `${project.orbit_owner}/${project.orbit_repo}`
    : null

  // Surface the orbit capacity-guard state so the indicator can flip
  // to a dedicated "degraded / out-of-disk" status when aura-os-server
  // has observed a `remote_storage_exhausted` push failure for this
  // project. Stuck state that is NOT storage-exhausted (e.g. transient
  // transport timeouts) keeps the indicator green; the banner elsewhere
  // still surfaces it, so we don't misleadingly flag orbit as down for
  // unrelated push flakes.
  const pushStuck = usePushStuck(project?.project_id)
  const orbitOutOfDisk =
    !!pushStuck && !pushStuck.dismissed && pushStuck.class === "remote_storage_exhausted"
  const status: "connected" | "disconnected" | "degraded" = !isConnected
    ? "disconnected"
    : orbitOutOfDisk
      ? "degraded"
      : "connected"

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [open])

  const handleMouseEnter = useCallback(() => setOpen(true), [])
  const handleMouseLeave = useCallback(() => setOpen(false), [])

  if (!project) return null

  return (
    <div
      ref={wrapperRef}
      className={styles.wrapper}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span className={styles.indicator}>
        <span className={styles.dot} data-status={status} />
        <FolderGit2 size={11} />
      </span>

      {open && (
        <div className={styles.statusCard}>
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>Orbit</span>
            <span className={styles.statusValue}>
              {repoLabel ?? "No repo linked"}
            </span>
          </div>
          {orbitUrl && (
            <div className={styles.statusRow}>
              <span className={styles.statusLabel}>URL</span>
              <span className={styles.statusValue}>{orbitUrl}</span>
            </div>
          )}
          {project.git_repo_url && (
            <div className={styles.statusRow}>
              <span className={styles.statusLabel}>Git URL</span>
              <span className={styles.statusValue}>{project.git_repo_url}</span>
            </div>
          )}
          {orbitOutOfDisk && (
            <div className={styles.statusRow}>
              <span className={styles.statusLabel}>Status</span>
              <span className={styles.statusValue}>
                Orbit out of disk
                {pushStuck?.retryAfterSecs
                  ? ` (retry in ~${formatCooldown(pushStuck.retryAfterSecs)})`
                  : ""}
                {pushStuck?.remediation ? `. ${pushStuck.remediation}` : ""}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
