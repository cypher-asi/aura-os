import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Text } from "@cypher-asi/zui";
import type { ProcessNode, ProcessEvent, ProcessEventContentBlock, ProcessArtifact, ProcessRun } from "../../../types";
import { processApi } from "../../../api/process";
import { useProcessStore } from "../stores/process-store";
import { useProcessSidekickStore } from "../stores/process-sidekick-store";
import styles from "../../../components/Preview/Preview.module.css";

interface NodeOutputTabProps {
  node: ProcessNode;
}

const POLL_INTERVAL = 4000;
const EMPTY_RUNS: ProcessRun[] = [];

const monoBox: React.CSSProperties = {
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
};

function ContentBlockView({ block }: { block: ProcessEventContentBlock }) {
  if (block.type === "text" && block.text) {
    return <div style={monoBox}>{block.text}</div>;
  }
  if (block.type === "thinking" && block.thinking) {
    return (
      <div style={{ ...monoBox, borderLeft: "2px solid rgba(139,92,246,0.5)", color: "var(--color-text-muted)" }}>
        {block.thinking}
      </div>
    );
  }
  if (block.type === "tool_use") {
    return (
      <div style={{ ...monoBox, borderLeft: "2px solid rgba(59,130,246,0.6)" }}>
        <span style={{ color: "#3b82f6", fontWeight: 600, fontSize: 11 }}>
          tool call
        </span>{" "}
        <span style={{ fontWeight: 600 }}>{block.name}</span>
      </div>
    );
  }
  if (block.type === "tool_result") {
    const resultText = block.result && block.result.length > 2000
      ? `${block.result.slice(0, 2000)}…`
      : block.result;
    return (
      <div
        style={{
          ...monoBox,
          borderLeft: block.is_error
            ? "2px solid rgba(239,68,68,0.6)"
            : "2px solid rgba(16,185,129,0.6)",
          color: "var(--color-text-muted)",
          fontSize: 11,
          maxHeight: 200,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 11, color: block.is_error ? "#ef4444" : "#10b981" }}>
          {block.is_error ? "error" : "result"}
        </span>{" "}
        <span style={{ color: "var(--color-text-muted)" }}>{block.name}</span>
        {resultText && (
          <div style={{ marginTop: 4 }}>{resultText}</div>
        )}
      </div>
    );
  }
  return null;
}

function ContentBlocksView({ blocks }: { blocks: ProcessEventContentBlock[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {blocks.map((block, i) => (
        <ContentBlockView key={i} block={block} />
      ))}
    </div>
  );
}

export function NodeOutputTab({ node }: NodeOutputTabProps) {
  const { processId } = useParams<{ processId: string }>();
  const runs = useProcessStore((s) => (processId ? s.runs[processId] : undefined)) ?? EMPTY_RUNS;
  const nodeStatuses = useProcessSidekickStore((s) => s.nodeStatuses);
  const [events, setEvents] = useState<ProcessEvent[]>([]);
  const [artifacts, setArtifacts] = useState<ProcessArtifact[]>([]);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const latestRun = runs[0];
  const isRunActive = latestRun && (latestRun.status === "running" || latestRun.status === "pending");

  const loadEvents = useCallback(async () => {
    if (!processId || !latestRun) return;
    try {
      const evts = await processApi.listRunEvents(processId, latestRun.run_id);
      setEvents(evts);
    } catch { /* ignore */ }
  }, [processId, latestRun?.run_id]);

  const loadArtifacts = useCallback(async () => {
    if (!processId || !latestRun) return;
    if (node.node_type !== "artifact") return;
    try {
      const list = await processApi.listRunArtifacts(processId, latestRun.run_id);
      setArtifacts(list.filter((a) => a.node_id === node.node_id));
    } catch { /* ignore */ }
  }, [processId, latestRun?.run_id, node.node_id, node.node_type]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadEvents(), loadArtifacts()]).finally(() => setLoading(false));
  }, [loadEvents, loadArtifacts]);

  useEffect(() => {
    if (isRunActive) {
      intervalRef.current = setInterval(() => {
        loadEvents();
        loadArtifacts();
      }, POLL_INTERVAL);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRunActive, loadEvents, loadArtifacts]);

  const currentNodeStatus = nodeStatuses[node.node_id];
  useEffect(() => {
    if (currentNodeStatus) {
      loadEvents();
      loadArtifacts();
    }
  }, [currentNodeStatus, loadEvents, loadArtifacts]);

  const nodeEvent = events.find((e) => e.node_id === node.node_id);
  const hasBlocks = nodeEvent?.content_blocks && nodeEvent.content_blocks.length > 0;

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

            {hasBlocks ? (
              <div className={styles.taskField}>
                <span className={styles.fieldLabel}>Conversation</span>
                <ContentBlocksView blocks={nodeEvent.content_blocks!} />
              </div>
            ) : nodeEvent.output ? (
              <div className={styles.taskField}>
                <span className={styles.fieldLabel}>Output</span>
                <div style={monoBox}>{nodeEvent.output}</div>
              </div>
            ) : null}

            {nodeEvent.input_snapshot && (
              <div className={styles.taskField}>
                <span className={styles.fieldLabel}>Input</span>
                <div
                  style={{
                    ...monoBox,
                    maxHeight: 200,
                    color: "var(--color-text-muted)",
                  }}
                >
                  {nodeEvent.input_snapshot}
                </div>
              </div>
            )}
          </>
        )}

        {!loading && !nodeEvent && isRunActive && currentNodeStatus === undefined && (
          <Text variant="secondary" size="sm" style={{ padding: 8 }}>
            Waiting for this node to execute...
          </Text>
        )}

        {!loading && !nodeEvent && !isRunActive && latestRun && (
          <Text variant="secondary" size="sm" style={{ padding: 8 }}>
            No output for this node in the latest run
          </Text>
        )}

        {artifacts.length > 0 && (
          <div className={styles.taskField}>
            <span className={styles.fieldLabel}>Artifacts</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {artifacts.map((a) => (
                <div
                  key={a.artifact_id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 8px",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: 12,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{a.name}</div>
                    <div style={{ color: "var(--color-text-muted)", fontSize: 11 }}>
                      {a.artifact_type} &middot; {(a.size_bytes / 1024).toFixed(1)} KB
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const content = await processApi.getArtifactContent(a.artifact_id);
                        const blob = new Blob([content as unknown as string], { type: "text/markdown" });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = `${a.name}.md`;
                        link.click();
                        URL.revokeObjectURL(url);
                      } catch { /* ignore */ }
                    }}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-sm)",
                      padding: "4px 8px",
                      cursor: "pointer",
                      fontSize: 11,
                      color: "var(--color-text)",
                    }}
                  >
                    Download
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
