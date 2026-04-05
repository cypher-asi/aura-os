import { useEffect } from "react";
import { Pin } from "lucide-react";
import { Text } from "@cypher-asi/zui";
import type { ProcessNode } from "../../../../types";
import type { ProcessNodeType } from "../../../../types/enums";
import { useAgentStore } from "../../../agents/stores";
import { Avatar } from "../../../../components/Avatar";
import { PinnedOutputField } from "../PinnedOutput";
import styles from "../../../../components/Preview/Preview.module.css";

const NODE_TYPE_LABELS: Record<ProcessNodeType, string> = {
  ignition: "Ignition",
  action: "Action",
  condition: "Condition",
  artifact: "Artifact",
  delay: "Delay",
  merge: "Merge",
};

interface NodeInfoTabProps {
  node: ProcessNode;
}

export function NodeInfoTab({ node }: NodeInfoTabProps) {
  const agents = useAgentStore((s) => s.agents);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

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

        {(node.node_type === "action" || node.node_type === "ignition") && (
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
            <Text variant="secondary" size="sm" className={styles.preWrapText}>{node.prompt}</Text>
          </div>
        )}

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
