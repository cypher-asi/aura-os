import { useCallback } from "react";
import { useParams } from "react-router-dom";
import { Text } from "@cypher-asi/zui";
import type { DebugRunMetadata, DebugRunStatus } from "../../../../api/debug";
import { api } from "../../../../api/client";
import type { ProjectId } from "../../../../shared/types";
import { useDebugRunMetadata } from "../../useDebugRunMetadata";
import { useDebugRunLogs } from "../../useDebugRunLogs";
import { copyToClipboard, downloadBlob } from "../../clipboard";
import { EmptyState } from "../../../../components/EmptyState";
import previewStyles from "../../../../components/Preview/Preview.module.css";
import styles from "./DebugSidekickContent.module.css";

/** Lightweight human-friendly label for run status. */
function statusLabel(status: DebugRunStatus): string {
  switch (status) {
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "interrupted":
      return "Interrupted";
    default:
      return status;
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatDuration(meta: DebugRunMetadata): string {
  const startedAt = meta.started_at
    ? new Date(meta.started_at).getTime()
    : NaN;
  const endedAt = meta.ended_at
    ? new Date(meta.ended_at).getTime()
    : Date.now();
  if (Number.isNaN(startedAt)) return "—";
  const ms = Math.max(0, endedAt - startedAt);
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

/**
 * Run-level summary shown in the Sidekick's "Run" tab. Replaces the
 * old in-main-panel toolbar + counters row so the middle surface can
 * focus on the event timeline.
 */
export function RunInfoTab() {
  const { projectId, runId } = useParams<{
    projectId: ProjectId;
    runId: string;
  }>();
  const { metadata, isRunning } = useDebugRunMetadata(projectId, runId);
  const { raw } = useDebugRunLogs({
    projectId,
    runId,
    channel: "events",
    isRunning,
  });

  const handleCopy = useCallback(() => {
    if (raw) void copyToClipboard(raw);
  }, [raw]);

  const handleExport = useCallback(async () => {
    if (!projectId || !runId) return;
    try {
      const blob = await api.debug.exportRunBlob(projectId, runId);
      downloadBlob(blob, `debug-${projectId}-${runId}.zip`);
    } catch (error) {
      console.error("debug export failed", error);
    }
  }, [projectId, runId]);

  if (!metadata) return <EmptyState>No run selected</EmptyState>;

  const counters = metadata.counters;

  return (
    <div className={previewStyles.previewBody}>
      <div className={previewStyles.taskMeta}>
        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Status</span>
          <span>
            <span className={`${styles.statusBadge} ${styles[`statusBadge_${metadata.status}`] ?? ""}`}>
              {statusLabel(metadata.status)}
            </span>
          </span>
        </div>

        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Started</span>
          <Text variant="secondary" size="sm">
            {formatDate(metadata.started_at)}
          </Text>
        </div>

        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Ended</span>
          <Text variant="secondary" size="sm">
            {formatDate(metadata.ended_at)}
          </Text>
        </div>

        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Duration</span>
          <Text variant="secondary" size="sm">
            {formatDuration(metadata)}
          </Text>
        </div>

        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Run ID</span>
          <Text
            variant="secondary"
            size="sm"
            style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
          >
            {metadata.run_id}
          </Text>
        </div>

        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Counters</span>
          <div className={styles.countersGrid}>
            <CounterPill label="events" value={counters.events_total} />
            <CounterPill label="llm" value={counters.llm_calls} />
            <CounterPill label="iter" value={counters.iterations} />
            <CounterPill label="blockers" value={counters.blockers} />
            <CounterPill label="retries" value={counters.retries} />
            <CounterPill label="tools" value={counters.tool_calls} />
            <CounterPill
              label="tokens"
              value={`${counters.input_tokens}→${counters.output_tokens}`}
            />
            <CounterPill
              label="tasks"
              value={`${counters.task_completed}/${counters.task_completed + counters.task_failed}`}
            />
          </div>
        </div>

        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Actions</span>
          <div className={styles.actionRow}>
            <button
              type="button"
              className={styles.actionButton}
              onClick={handleCopy}
              disabled={!raw}
            >
              Copy JSONL
            </button>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => {
                void handleExport();
              }}
            >
              Export .zip
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CounterPill({ label, value }: { label: string; value: number | string }) {
  return (
    <span className={styles.counterPill}>
      <span className={styles.counterPillLabel}>{label}</span>
      <span className={styles.counterPillValue}>{value}</span>
    </span>
  );
}
