import { useMemo } from "react";
import type { DebugLogEntry } from "../../types";
import styles from "./DebugSidekickContent.module.css";

interface Props {
  entries: DebugLogEntry[];
}

/**
 * Per-channel breakdown shown beneath the filter controls. The middle
 * panel already renders the timeline itself, so we avoid duplicating
 * it here — instead we surface the frequency of each event type so
 * users can spot outliers (e.g. many `retry` events) before opening
 * the timeline.
 */
export function ChannelSummary({ entries }: Props) {
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) {
      map.set(entry.type, (map.get(entry.type) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className={styles.channelEmpty}>
        No events recorded on this channel yet.
      </div>
    );
  }

  return (
    <div className={styles.channelSummary}>
      <div className={styles.channelSummaryHeader}>
        {entries.length} event{entries.length === 1 ? "" : "s"}
      </div>
      <ul className={styles.channelTypeList}>
        {counts.map(([type, count]) => (
          <li key={type} className={styles.channelTypeRow}>
            <span className={styles.channelTypeName}>{type}</span>
            <span className={styles.channelTypeCount}>{count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
