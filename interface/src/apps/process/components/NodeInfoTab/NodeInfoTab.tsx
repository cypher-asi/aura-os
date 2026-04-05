import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Pin } from "lucide-react";
import { Text } from "@cypher-asi/zui";
import type { ProcessNode, ProcessEvent } from "../../../../types";
import type { ProcessNodeType } from "../../../../types/enums";
import { processApi } from "../../../../api/process";
import { useProcessStore } from "../../stores/process-store";
import { useAgentStore } from "../../../agents/stores";
import { Avatar } from "../../../../components/Avatar";
import { PinnedOutputField } from "../PinnedOutput";
import { monoBox } from "../NodeOutputTab/node-output-utils";
import styles from "../../../../components/Preview/Preview.module.css";

const MAX_LINES = 5;

function TruncatedLines({ text, mono }: { text: string; mono?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const needsTruncation = lines.length > MAX_LINES;
  const display = !expanded && needsTruncation
    ? lines.slice(0, MAX_LINES).join("\n")
    : text;

  return (
    <div>
      <Text
        variant="secondary"
        size="sm"
        className={styles.preWrapText}
        style={mono ? { fontFamily: "var(--font-mono)", fontSize: 12 } : undefined}
      >
        {display}
        {!expanded && needsTruncation && "\u2026"}
      </Text>
      {needsTruncation && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            marginTop: 4,
            fontSize: 11,
            color: "var(--color-text-link, #3b82f6)",
            cursor: "pointer",
          }}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

const EMPTY_RUNS: never[] = [];

const NODE_TYPE_LABELS: Record<ProcessNodeType, string> = {
  ignition: "Ignition",
  action: "Action",
  condition: "Condition",
  artifact: "Artifact",
  delay: "Delay",
  merge: "Merge",
  prompt: "Prompt",
  sub_process: "SubProcess",
  for_each: "ForEach",
};

interface NodeInfoTabProps {
  node: ProcessNode;
}

export function NodeInfoTab({ node }: NodeInfoTabProps) {
  const { processId } = useParams<{ processId: string }>();
  const agents = useAgentStore((s) => s.agents);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const runs = useProcessStore((s) => (processId ? s.runs[processId] : undefined)) ?? EMPTY_RUNS;
  const latestRun = runs[0];

  const [nodeEvent, setNodeEvent] = useState<ProcessEvent | null>(null);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const loadEvent = useCallback(async () => {
    if (!processId || !latestRun) { setNodeEvent(null); return; }
    try {
      const evts = await processApi.listRunEvents(processId, latestRun.run_id);
      setNodeEvent(evts.find((e) => e.node_id === node.node_id) ?? null);
    } catch { setNodeEvent(null); }
  }, [processId, latestRun?.run_id, node.node_id]);

  useEffect(() => { loadEvent(); }, [loadEvent]);

  const agent = node.agent_id
    ? agents.find((a) => a.agent_id === node.agent_id) ?? null
    : null;
  const cfg = node.config as Record<string, unknown>;

  return (
    <div className={styles.previewBody}>
      <div className={styles.taskMeta}>
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Label</span>
          <Text size="sm">{node.label}</Text>
        </div>

        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Type</span>
          <Text size="sm">{NODE_TYPE_LABELS[node.node_type]}</Text>
        </div>

        {!!cfg?.pinned_output && (
          <div className={styles.taskField}>
            <span className={styles.fieldLabel}>Status</span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                padding: "2px 8px",
                background: "rgba(245,158,11,0.15)",
                color: "#f59e0b",
                fontWeight: 600,
              }}
            >
              <Pin size={10} />
              Pinned
            </span>
          </div>
        )}

        {!!cfg?.pinned_output && (
          <PinnedOutputField text={cfg.pinned_output as string} />
        )}

        {(node.node_type === "action" || node.node_type === "ignition" || node.node_type === "prompt") && (
          <div className={styles.taskField}>
            <span className={styles.fieldLabel}>Agent</span>
            {agent ? (
              <div className={styles.agentInline}>
                <Avatar avatarUrl={agent.icon ?? undefined} name={agent.name} type="agent" size={18} />
                <Text variant="secondary" size="sm">{agent.name}</Text>
              </div>
            ) : (
              <Text variant="secondary" size="sm">None</Text>
            )}
          </div>
        )}

        {node.node_type !== "merge" && node.node_type !== "delay" && node.prompt && (
          <div className={styles.taskField}>
            <span className={styles.fieldLabel}>Prompt</span>
            <TruncatedLines text={node.prompt} />
          </div>
        )}

        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Output</span>
          {nodeEvent?.output ? (
            <div style={monoBox}>{nodeEvent.output}</div>
          ) : (
            <div style={{ ...monoBox, color: "var(--color-text-muted)" }}>
              No output yet
            </div>
          )}
        </div>

        {node.node_type === "ignition" && (
          <div className={styles.taskField}>
            <span className={styles.fieldLabel}>Schedule</span>
            <Text variant="secondary" size="sm" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
              {(cfg?.schedule as string) || "Manual only"}
            </Text>
          </div>
        )}

        {node.node_type === "condition" && (cfg?.condition_expression as string) && (
          <div className={styles.taskField}>
            <span className={styles.fieldLabel}>Condition</span>
            <Text variant="secondary" size="sm" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
              {cfg.condition_expression as string}
            </Text>
          </div>
        )}

        {node.node_type === "artifact" && (
          <>
            {(cfg?.artifact_name as string) && (
              <div className={styles.taskField}>
                <span className={styles.fieldLabel}>Artifact Name</span>
                <Text variant="secondary" size="sm">{cfg.artifact_name as string}</Text>
              </div>
            )}
            <div className={styles.taskField}>
              <span className={styles.fieldLabel}>Artifact Type</span>
              <Text variant="secondary" size="sm">{(cfg?.artifact_type as string) || "report"}</Text>
            </div>
          </>
        )}

        {node.node_type === "delay" && (
          <div className={styles.taskField}>
            <span className={styles.fieldLabel}>Delay</span>
            <Text variant="secondary" size="sm">{String(cfg?.delay_seconds ?? 60)} seconds</Text>
          </div>
        )}

        <div className={styles.taskField} style={{ borderTop: "1px solid var(--color-border)", paddingTop: 12, marginTop: 4 }}>
          <span className={styles.fieldLabel}>Node ID</span>
          <Text variant="secondary" size="sm" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{node.node_id}</Text>
        </div>
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Created</span>
          <Text variant="secondary" size="sm">{new Date(node.created_at).toLocaleString()}</Text>
        </div>
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Updated</span>
          <Text variant="secondary" size="sm">{new Date(node.updated_at).toLocaleString()}</Text>
        </div>
      </div>
    </div>
  );
}
