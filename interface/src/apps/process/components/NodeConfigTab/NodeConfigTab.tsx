import { useState } from "react";
import { Pencil, Pin } from "lucide-react";
import { Button, Text } from "@cypher-asi/zui";
import type { ProcessNode } from "../../../../types";
import type { ProcessNodeType } from "../../../../types/enums";
import { useProcessSidekickStore } from "../../stores/process-sidekick-store";
import { useAgentStore } from "../../../agents/stores";
import styles from "../../../../components/Preview/Preview.module.css";

const TRUNCATE_LIMIT = 400;

function TruncatedText({ text, mono }: { text: string; mono?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = text.length > TRUNCATE_LIMIT;
  const display = !expanded && needsTruncation ? text.slice(0, TRUNCATE_LIMIT) + "\u2026" : text;

  return (
    <div>
      <Text
        variant="secondary"
        size="sm"
        className={styles.preWrapText}
        style={mono ? { fontFamily: "var(--font-mono)", fontSize: 12 } : undefined}
      >
        {display}
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

const NODE_TYPE_LABELS: Record<ProcessNodeType, string> = {
  ignition: "Ignition",
  action: "Action",
  condition: "Condition",
  artifact: "Artifact",
  delay: "Delay",
  merge: "Merge",
};

interface NodeConfigTabProps {
  node: ProcessNode;
}

export function NodeConfigTab({ node }: NodeConfigTabProps) {
  const requestEdit = useProcessSidekickStore((s) => s.requestEdit);
  const agents = useAgentStore((s) => s.agents);
  const cfg = node.config as Record<string, unknown>;

  const agentName = node.agent_id
    ? agents.find((a) => a.agent_id === node.agent_id)?.name ?? node.agent_id
    : "None";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className={styles.previewHeader}>
        <Text size="sm" className={`${styles.previewTitle} ${styles.previewTitleBold}`}>
          {NODE_TYPE_LABELS[node.node_type]} Config
        </Text>
        <Button variant="ghost" size="sm" iconOnly icon={<Pencil size={14} />} title="Edit" onClick={requestEdit} />
      </div>
      <div className={styles.previewBody}>
        <div className={styles.taskMeta}>
          <div className={styles.taskField}>
            <span className={styles.fieldLabel}>Label</span>
            <Text size="sm">{node.label}</Text>
          </div>

          {node.node_type === "ignition" && (
            <div className={styles.taskField}>
              <span className={styles.fieldLabel}>Schedule</span>
              <Text variant="secondary" size="sm" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {(cfg?.schedule as string) || "Manual only"}
              </Text>
            </div>
          )}

          {(node.node_type === "action" || node.node_type === "ignition") && (
            <div className={styles.taskField}>
              <span className={styles.fieldLabel}>Agent</span>
              <Text variant="secondary" size="sm">{agentName}</Text>
            </div>
          )}

          {node.node_type !== "merge" && node.node_type !== "delay" && node.prompt && (
            <div className={styles.taskField}>
              <span className={styles.fieldLabel}>Prompt</span>
              <TruncatedText text={node.prompt} />
            </div>
          )}

          {!!cfg?.pinned_output && (
            <div className={styles.taskField}>
              <span className={styles.fieldLabel} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <Pin size={10} style={{ color: "#f59e0b" }} />
                Pinned Output
                <span style={{ fontSize: 10, color: "#f59e0b", fontWeight: 600 }}>&mdash; skips execution</span>
              </span>
              <TruncatedText text={cfg.pinned_output as string} mono />
            </div>
          )}

          {node.node_type === "condition" && (cfg?.condition_expression as string) && (
            <div className={styles.taskField}>
              <span className={styles.fieldLabel}>Condition Expression</span>
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
              {cfg?.data != null && Object.keys(cfg.data as object).length > 0 && (
                <div className={styles.taskField}>
                  <span className={styles.fieldLabel}>Data</span>
                  <Text variant="secondary" size="sm" style={{ fontFamily: "var(--font-mono)", fontSize: 11, whiteSpace: "pre-wrap" }}>
                    {String(JSON.stringify(cfg.data, null, 2))}
                  </Text>
                </div>
              )}
            </>
          )}

          {node.node_type === "delay" && (
            <div className={styles.taskField}>
              <span className={styles.fieldLabel}>Delay</span>
              <Text variant="secondary" size="sm">{String(cfg?.delay_seconds ?? 60)} seconds</Text>
            </div>
          )}

          {node.node_type === "action" && (cfg?.vault_path as string) && (
            <div className={styles.taskField}>
              <span className={styles.fieldLabel}>Vault Path</span>
              <Text variant="secondary" size="sm">{cfg.vault_path as string}</Text>
            </div>
          )}

          {node.node_type === "ignition" && cfg?.watchlist != null && (
            <div className={styles.taskField}>
              <span className={styles.fieldLabel}>Watchlist</span>
              <Text variant="secondary" size="sm" style={{ fontFamily: "var(--font-mono)", fontSize: 11, whiteSpace: "pre-wrap" }}>
                {String(JSON.stringify(cfg.watchlist, null, 2))}
              </Text>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
