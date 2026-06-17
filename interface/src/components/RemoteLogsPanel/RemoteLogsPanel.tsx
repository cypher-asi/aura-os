import { useCallback, useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { api } from "../../api/client"
import type { RemoteVmLogEntry } from "../../shared/types"
import styles from "./RemoteLogsPanel.module.css"

/** Merged entries requested per refresh (newest kept by the gateway). */
const LOG_TAIL = 200

/** How often to auto-refresh the tail so boot/attestation output streams in. */
const POLL_INTERVAL_MS = 3_000

function formatLogTime(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp
  return date.toLocaleTimeString([], { hour12: false })
}

interface RemoteLogsPanelProps {
  agentId: string
  /**
   * Poll the tail on an interval while mounted (default on). The gateway
   * already merges live pod stdout with termination snapshots, so a periodic
   * full-tail refetch is enough to stream boot/attestation output without a
   * cursor.
   */
  live?: boolean
}

/**
 * VM/platform logs for a remote agent: the live pod stdout tail merged
 * with the termination snapshots the swarm captures when a VM
 * hibernates/stops, each line tagged with its source. Detailed in-VM
 * agent logs stay sealed inside the guest and are not shown here.
 */
export function RemoteLogsPanel({ agentId, live = true }: RemoteLogsPanelProps) {
  const [entries, setEntries] = useState<RemoteVmLogEntry[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // `silent` background polls must not flip the visible loading state or the
  // panel would flash "Loading…" every few seconds. Only the initial load and
  // the manual Refresh button surface the spinner.
  const fetchLogs = useCallback(
    (silent = false) => {
      api.swarm
        .getRemoteAgentLogs(agentId, LOG_TAIL)
        .then((res) => {
          setEntries(res.logs)
          setError(null)
        })
        .catch((e: unknown) => {
          if (!silent) {
            setError(e instanceof Error ? e.message : "Failed to load logs")
          }
        })
        .finally(() => {
          if (!silent) setLoading(false)
        })
    },
    [agentId],
  )

  useEffect(() => {
    fetchLogs()
    if (!live) return
    const interval = setInterval(() => fetchLogs(true), POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [fetchLogs, live])

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <span className={styles.title}>VM logs</span>
        <button
          type="button"
          className={styles.refreshBtn}
          onClick={(e) => {
            e.stopPropagation()
            setLoading(true)
            fetchLogs()
          }}
          disabled={loading}
          aria-label="Refresh VM logs"
        >
          <RefreshCw size={12} aria-hidden="true" />
          <span>{loading ? "Loading…" : "Refresh"}</span>
        </button>
      </div>
      {error ? (
        <div className={styles.notice}>{error}</div>
      ) : entries && entries.length === 0 ? (
        <div className={styles.notice}>No platform logs yet.</div>
      ) : entries ? (
        <div className={styles.pane}>
          {entries.map((entry, index) => (
            <div key={`${entry.timestamp}-${index}`} className={styles.line}>
              <span className={styles.time} title={entry.timestamp}>
                {formatLogTime(entry.timestamp)}
              </span>
              <span className={styles.sourceBadge} data-source={entry.source}>
                {entry.source}
              </span>
              <span className={styles.text}>{entry.line}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.notice}>Loading logs…</div>
      )}
    </div>
  )
}
