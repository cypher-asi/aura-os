import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Text } from "@cypher-asi/zui";
import type {
  ProcessNode,
  ProcessEvent,
  ProcessArtifact,
  ProcessRun,
} from "../../../../shared/types";
import { processApi } from "../../../../shared/api/process";
import { useProcessStore } from "../../stores/process-store";
import { useProcessSidekickStore } from "../../stores/process-sidekick-store";
import { PinnedOutputField, PinOutputButton } from "../PinnedOutput";
import { monoBox, prettyPrintIfJson } from "./node-output-utils";
import { ProcessEventOutput } from "../ProcessEventOutput";
import { ArtifactCard } from "../ProcessSidekickContent/ArtifactCard";
import styles from "../../../../components/Preview/Preview.module.css";

interface NodeOutputTabProps {
  node: ProcessNode;
}

const POLL_INTERVAL = 4000;
const EMPTY_RUNS: ProcessRun[] = [];
const SUCCESS_COLOR = "var(--color-success, #4aeaa8)";
const SUCCESS_BACKGROUND = "color-mix(in srgb, var(--color-success, #4aeaa8) 15%, transparent)";

export function NodeOutputTab({ node }: NodeOutputTabProps) {
  const { processId } = useParams<{ processId: string }>();
  const runs =
    useProcessStore((s) => (processId ? s.runs[processId] : undefined)) ??
    EMPTY_RUNS;
  const nodeStatuses = useProcessSidekickStore((s) => s.nodeStatuses);
  const setStoreEvents = useProcessStore((s) => s.setEvents);

  const latestRun = runs[0];
  const cachedEvents = useProcessStore((s) => latestRun ? s.events[latestRun.run_id] : undefined);
  const [events, setEvents] = useState<ProcessEvent[]>(cachedEvents ?? []);
  const [artifacts, setArtifacts] = useState<ProcessArtifact[]>([]);
  const [loading, setLoading] = useState(!cachedEvents?.length);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      setStoreEvents(latestRun.run_id, evts);
    } catch {
      /* ignore */
    }
  }, [processId, latestRun?.run_id, setStoreEvents]);

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

        {!loading && artifacts.length > 0 && <ArtifactList artifacts={artifacts} />}

        {!loading && nodeEvent && (
          <NodeEventDetails
            nodeEvent={nodeEvent}
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
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function NodeEventDetails({
  nodeEvent,
  node,
}: {
  nodeEvent: ProcessEvent;
  node: ProcessNode;
}) {
  const statusColor =
    nodeEvent.status === "completed"
      ? { bg: SUCCESS_BACKGROUND, fg: SUCCESS_COLOR }
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

      <div className={styles.taskField}>
        <span className={styles.fieldLabel}>Output</span>
        <ProcessEventOutput event={nodeEvent} />
        {!nodeEvent.output && (!nodeEvent.content_blocks || nodeEvent.content_blocks.length === 0) && (
          <div style={{ ...monoBox, color: "var(--color-text-muted)" }}>
            No output
          </div>
        )}
      </div>

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
            {prettyPrintIfJson(nodeEvent.input_snapshot)}
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
        {artifacts.map((a) => <ArtifactCard key={a.artifact_id} artifact={a} />)}
      </div>
    </div>
  );
}
