import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Text } from "@cypher-asi/zui";
import type {
  ProcessNode,
  ProcessEvent,
  ProcessArtifact,
  ProcessRun,
} from "../../../../types";
import { processApi } from "../../../../api/process";
import { useProcessStore } from "../../stores/process-store";
import { useProcessSidekickStore } from "../../stores/process-sidekick-store";
import { ActivityTimeline } from "../../../../components/ActivityTimeline";
import { PinnedOutputField, PinOutputButton } from "../PinnedOutput";
import { monoBox, contentBlocksToTimeline } from "./node-output-utils";
import styles from "../../../../components/Preview/Preview.module.css";

interface NodeOutputTabProps {
  node: ProcessNode;
}

const POLL_INTERVAL = 4000;
const EMPTY_RUNS: ProcessRun[] = [];

export function NodeOutputTab({ node }: NodeOutputTabProps) {
  const { processId } = useParams<{ processId: string }>();
  const runs =
    useProcessStore((s) => (processId ? s.runs[processId] : undefined)) ??
    EMPTY_RUNS;
  const nodeStatuses = useProcessSidekickStore((s) => s.nodeStatuses);
  const [events, setEvents] = useState<ProcessEvent[]>([]);
  const [artifacts, setArtifacts] = useState<ProcessArtifact[]>([]);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const latestRun = runs[0];
  const isRunActive =
    latestRun &&
    (latestRun.status === "running" || latestRun.status === "pending");

  const loadEvents = useCallback(async () => {
    if (!processId || !latestRun) return;
    try {
      const evts = await processApi.listRunEvents(
        processId,
        latestRun.run_id,
      );
      setEvents(evts);
    } catch {
      /* ignore */
    }
  }, [processId, latestRun?.run_id]);

  const loadArtifacts = useCallback(async () => {
    if (!processId || !latestRun) return;
    if (node.node_type !== "artifact") return;
    try {
      const list = await processApi.listRunArtifacts(
        processId,
        latestRun.run_id,
      );
      setArtifacts(list.filter((a) => a.node_id === node.node_id));
    } catch {
      /* ignore */
    }
  }, [processId, latestRun?.run_id, node.node_id, node.node_type]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadEvents(), loadArtifacts()]).finally(() =>
      setLoading(false),
    );
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
  const hasBlocks =
    nodeEvent?.content_blocks && nodeEvent.content_blocks.length > 0;

  const { timeline, toolCalls, thinkingText } = useMemo(
    () =>
      hasBlocks
        ? contentBlocksToTimeline(nodeEvent!.content_blocks!)
        : { timeline: [], toolCalls: [], thinkingText: "" },
    [hasBlocks, nodeEvent?.content_blocks],
  );

  const pinnedOutput = node.config?.pinned_output as string | undefined;

  return (
    <div className={styles.previewBody}>
      <div className={styles.taskMeta}>
        {pinnedOutput && <PinnedOutputField text={pinnedOutput} />}

        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Run</span>
          <Text variant="secondary" size="sm">
            {latestRun
              ? `${latestRun.trigger} \u00b7 ${latestRun.status} \u00b7 ${new Date(latestRun.started_at).toLocaleString()}`
              : "No runs yet"}
          </Text>
        </div>

        {loading && (
          <Text variant="secondary" size="sm" style={{ padding: 8 }}>
            Loading...
          </Text>
        )}

        {!loading && nodeEvent && (
          <NodeEventDetails
            nodeEvent={nodeEvent}
            hasBlocks={!!hasBlocks}
            timeline={timeline}
            toolCalls={toolCalls}
            thinkingText={thinkingText}
            node={node}
          />
        )}

        {!loading &&
          !nodeEvent &&
          isRunActive &&
          currentNodeStatus === undefined && (
            <Text variant="secondary" size="sm" style={{ padding: 8 }}>
              Waiting for this node to execute...
            </Text>
          )}

        {!loading && !nodeEvent && !isRunActive && latestRun && (
          <Text variant="secondary" size="sm" style={{ padding: 8 }}>
            No output for this node in the latest run
          </Text>
        )}

        {artifacts.length > 0 && <ArtifactList artifacts={artifacts} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function NodeEventDetails({
  nodeEvent,
  hasBlocks,
  timeline,
  toolCalls,
  thinkingText,
  node,
}: {
  nodeEvent: ProcessEvent;
  hasBlocks: boolean;
  timeline: import("../../../../types/stream").TimelineItem[];
  toolCalls: import("../../../../types/stream").ToolCallEntry[];
  thinkingText: string;
  node: ProcessNode;
}) {
  const statusColor =
    nodeEvent.status === "completed"
      ? { bg: "rgba(16,185,129,0.15)", fg: "#10b981" }
      : nodeEvent.status === "failed"
        ? { bg: "rgba(239,68,68,0.15)", fg: "#ef4444" }
        : nodeEvent.status === "skipped"
          ? { bg: "rgba(107,114,128,0.15)", fg: "#6b7280" }
          : { bg: "rgba(59,130,246,0.15)", fg: "#3b82f6" };

  return (
    <>
      <div className={styles.taskField}>
        <span className={styles.fieldLabel}>Status</span>
        <span
          style={{
            display: "inline-block",
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 0,
            background: statusColor.bg,
            color: statusColor.fg,
            fontWeight: 600,
          }}
        >
          {nodeEvent.status}
        </span>
      </div>

      {nodeEvent.status === "completed" && nodeEvent.output && (
        <div className={styles.taskField}>
          <PinOutputButton node={node} output={nodeEvent.output} />
        </div>
      )}

      {hasBlocks ? (
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Conversation</span>
          <ActivityTimeline
            timeline={timeline}
            thinkingText={thinkingText}
            toolCalls={toolCalls}
            isStreaming={false}
          />
        </div>
      ) : (
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Output</span>
          {nodeEvent.output ? (
            <div style={monoBox}>{nodeEvent.output}</div>
          ) : (
            <div style={{ ...monoBox, color: "var(--color-text-muted)" }}>
              No output
            </div>
          )}
        </div>
      )}

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
  );
}

function ArtifactList({
  artifacts,
}: {
  artifacts: ProcessArtifact[];
}) {
  return (
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
              <div
                style={{
                  color: "var(--color-text-muted)",
                  fontSize: 11,
                }}
              >
                {a.artifact_type} &middot;{" "}
                {(a.size_bytes / 1024).toFixed(1)} KB
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  const content = await processApi.getArtifactContent(
                    a.artifact_id,
                  );
                  const blob = new Blob(
                    [content as unknown as string],
                    { type: "text/markdown" },
                  );
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `${a.name}.md`;
                  link.click();
                  URL.revokeObjectURL(url);
                } catch {
                  /* ignore */
                }
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
  );
}
