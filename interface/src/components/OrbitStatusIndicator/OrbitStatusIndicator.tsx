import { useState, useRef, useEffect, useCallback } from "react"
import { FolderGit2 } from "lucide-react"
import type { Project } from "../../types"
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

export function OrbitStatusIndicator({ project }: OrbitStatusIndicatorProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const isConnected = !!(project?.orbit_owner?.trim() && project?.orbit_repo?.trim())
  const orbitUrl = project ? resolveOrbitUrl(project) : null
  const repoLabel = project && isConnected
    ? `${project.orbit_owner}/${project.orbit_repo}`
    : null

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
        <FolderGit2 size={11} />
        <span className={styles.dot} data-status={isConnected ? "connected" : "disconnected"} />
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
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>Local path</span>
            <span className={styles.statusValue}>{project.linked_folder_path || "—"}</span>
          </div>
        </div>
      )}
    </div>
  )
}
