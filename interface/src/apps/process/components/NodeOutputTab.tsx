import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Text } from "@cypher-asi/zui";
import type { ProcessNode, ProcessEvent } from "../../../types";
import { processApi } from "../../../api/process";
import { useProcessStore } from "../stores/process-store";
import styles from "../../../components/Preview/Preview.module.css";

interface NodeOutputTabProps {
  node: ProcessNode;
}

export function NodeOutputTab({ node }: NodeOutputTabProps) {
  const { processId } = useParams<{ processId: string }>();
  const runs = useProcessStore((s) => (processId ? s.runs[processId] ?? [] : []));
  const [events, setEvents] = useState<ProcessEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const latestRun = runs[0];

  const loadEvents = useCallback(async () => {
    if (!processId || !latestRun) return;
    setLoading(true);
    try {
      const evts = await processApi.listRunEvents(processId, latestRun.run_id);
      setEvents(evts);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [processId, latestRun]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const nodeEvent = events.find((e) => e.node_id === node.node_id);

  return (
    <div className={styles.previewBody}>
      <div className={styles.taskMeta}>
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Run</span>
          <Text variant="secondary" size="sm">
            {latestRun
              ? `${latestRun.trigger} · ${latestRun.status} · ${new Date(latestRun.started_at).toLocaleString()}`
              : "No runs yet"}
          </Text>
        </div>

        {loading && (
          <Text variant="secondary" size="sm" style={{ padding: 8 }}>
            Loading...
          </Text>
        )}

        {!loading && nodeEvent && (
          <>
            <div className={styles.taskField}>
              <span className={styles.fieldLabel}>Status</span>
              <span
                style={{
                  display: "inline-block",
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 0,
                  background:
                    nodeEvent.status === "completed"
                      ? "rgba(16,185,129,0.15)"
                      : nodeEvent.status === "failed"
                        ? "rgba(239,68,68,0.15)"
                        : nodeEvent.status === "skipped"
                          ? "rgba(107,114,128,0.15)"
                          : "rgba(59,130,246,0.15)",
                  color:
                    nodeEvent.status === "completed"
                      ? "#10b981"
                      : nodeEvent.status === "failed"
                        ? "#ef4444"
                        : nodeEvent.status === "skipped"
                          ? "#6b7280"
                          : "#3b82f6",
                  fontWeight: 600,
                }}
              >
                {nodeEvent.status}
              </span>
            </div>

            {nodeEvent.output && (
              <div className={styles.taskField}>
                <span className={styles.fieldLabel}>Output</span>
                <div
                  style={{
                    background: "var(--color-bg-input)",
                    padding: 8,
                    borderRadius: "var(--radius-sm)",
                    whiteSpace: "pre-wrap",
                    fontSize: 12,
                    fontFamily: "var(--font-mono)",
                    maxHeight: 400,
                    overflow: "auto",
                    lineHeight: 1.5,
                    color: "var(--color-text)",
                  }}
                >
                  {nodeEvent.output}
                </div>
              </div>
            )}

            {nodeEvent.input_snapshot && (
              <div className={styles.taskField}>
                <span className={styles.fieldLabel}>Input</span>
                <div
                  style={{
                    background: "var(--color-bg-input)",
                    padding: 8,
                    borderRadius: "var(--radius-sm)",
                    whiteSpace: "pre-wrap",
                    fontSize: 12,
                    fontFamily: "var(--font-mono)",
                    maxHeight: 200,
                    overflow: "auto",
                    lineHeight: 1.5,
                    color: "var(--color-text-muted)",
                  }}
                >
                  {nodeEvent.input_snapshot}
                </div>
              </div>
            )}
          </>
        )}

        {!loading && !nodeEvent && latestRun && (
          <Text variant="secondary" size="sm" style={{ padding: 8 }}>
            No output for this node in the latest run
          </Text>
        )}
      </div>
    </div>
  );
}
