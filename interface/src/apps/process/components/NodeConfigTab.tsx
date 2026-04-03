import { useState, useCallback, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Pencil, Save, Trash2, X } from "lucide-react";
import { Button, Text } from "@cypher-asi/zui";
import type { ProcessNode } from "../../../types";
import type { ProcessNodeType } from "../../../types/enums";
import { processApi } from "../../../api/process";
import { useProcessStore } from "../stores/process-store";
import { useProcessSidekickStore } from "../stores/process-sidekick-store";
import { useAgentStore } from "../../agents/stores";
import styles from "../../../components/Preview/Preview.module.css";

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

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.taskField}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-input)",
  color: "var(--color-text)",
  colorScheme: "dark",
  fontSize: 13,
  fontFamily: "inherit",
  width: "100%",
  outline: "none",
  boxSizing: "border-box",
};

export function NodeConfigTab({ node }: NodeConfigTabProps) {
  const { processId } = useParams<{ processId: string }>();
  const fetchNodes = useProcessStore((s) => s.fetchNodes);
  const closeNodeInspector = useProcessSidekickStore((s) => s.closeNodeInspector);
  const agents = useAgentStore((s) => s.agents);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);

  const [editing, setEditing] = useState(false);

  const [label, setLabel] = useState(node.label);
  const [prompt, setPrompt] = useState(node.prompt);
  const [agentId, setAgentId] = useState(node.agent_id ?? "");
  const cfg = node.config as Record<string, unknown>;
  const [schedule, setSchedule] = useState(
    node.node_type === "ignition" ? (cfg?.schedule as string) ?? "" : "",
  );
  const [conditionExpr, setConditionExpr] = useState(
    node.node_type === "condition" ? (cfg?.condition_expression as string) ?? "" : "",
  );
  const [artifactType, setArtifactType] = useState(
    node.node_type === "artifact" ? (cfg?.artifact_type as string) ?? "report" : "report",
  );
  const [artifactName, setArtifactName] = useState(
    node.node_type === "artifact" ? (cfg?.artifact_name as string) ?? "" : "",
  );
  const [delaySeconds, setDelaySeconds] = useState(
    node.node_type === "delay" ? String(cfg?.delay_seconds ?? "60") : "60",
  );
  const [vaultPath, setVaultPath] = useState(
    node.node_type === "action" ? (cfg?.vault_path as string) ?? "" : "",
  );
  const [watchlist, setWatchlist] = useState(
    node.node_type === "ignition" ? JSON.stringify(cfg?.watchlist ?? {}, null, 2) : "{}",
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  useEffect(() => {
    setLabel(node.label);
    setPrompt(node.prompt);
    setAgentId(node.agent_id ?? "");
    setEditing(false);
    const c = node.config as Record<string, unknown>;
    if (node.node_type === "ignition") setSchedule((c?.schedule as string) ?? "");
    if (node.node_type === "condition") setConditionExpr((c?.condition_expression as string) ?? "");
    if (node.node_type === "artifact") {
      setArtifactType((c?.artifact_type as string) ?? "report");
      setArtifactName((c?.artifact_name as string) ?? "");
    }
    if (node.node_type === "delay") setDelaySeconds(String(c?.delay_seconds ?? "60"));
    if (node.node_type === "action") setVaultPath((c?.vault_path as string) ?? "");
    if (node.node_type === "ignition") setWatchlist(JSON.stringify(c?.watchlist ?? {}, null, 2));
  }, [node]);

  const handleSave = useCallback(async () => {
    if (!processId) return;
    setSaving(true);
    try {
      const config: Record<string, unknown> = { ...(node.config as Record<string, unknown>) };
      if (node.node_type === "ignition" && schedule) config.schedule = schedule;
      if (node.node_type === "condition") config.condition_expression = conditionExpr;
      if (node.node_type === "artifact") {
        config.artifact_type = artifactType;
        config.artifact_name = artifactName;
      }
      if (node.node_type === "delay") config.delay_seconds = Number(delaySeconds) || 60;
      if (node.node_type === "action" && vaultPath) config.vault_path = vaultPath;
      if (node.node_type === "ignition" && watchlist) {
        try { config.watchlist = JSON.parse(watchlist); } catch { /* keep existing */ }
      }

      await processApi.updateNode(processId, node.node_id, {
        label,
        prompt,
        agent_id: agentId || undefined,
        config,
      });
      if (node.node_type === "ignition" && schedule) {
        await processApi.updateProcess(processId, { schedule });
      }
      fetchNodes(processId);
      setEditing(false);
    } catch (e) {
      console.error("Failed to save node:", e);
    } finally {
      setSaving(false);
    }
  }, [processId, node, label, prompt, agentId, schedule, conditionExpr, artifactType, artifactName, delaySeconds, fetchNodes]);

  const handleDelete = useCallback(async () => {
    if (!processId || node.node_type === "ignition") return;
    try {
      await processApi.deleteNode(processId, node.node_id);
      fetchNodes(processId);
      closeNodeInspector();
    } catch (e) {
      console.error("Failed to delete node:", e);
    }
  }, [processId, node, fetchNodes, closeNodeInspector]);

  if (editing) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div className={styles.previewHeader}>
          <Text size="sm" className={`${styles.previewTitle} ${styles.previewTitleBold}`}>
            Edit {NODE_TYPE_LABELS[node.node_type]} Node
          </Text>
          {node.node_type !== "ignition" && (
            <Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={14} />} title="Delete node" onClick={handleDelete} />
          )}
          <Button variant="ghost" size="sm" icon={<Save size={14} />} onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button variant="ghost" size="sm" iconOnly icon={<X size={14} />} aria-label="Cancel" onClick={() => setEditing(false)} />
        </div>
        <div className={styles.previewBody}>
          <div className={styles.taskMeta}>
            <EditField label="Label">
              <input style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Node label" />
            </EditField>

            {node.node_type === "ignition" && (
              <EditField label="Schedule (cron expression)">
                <input style={inputStyle} value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="e.g. 0 9 * * * (daily at 9 AM)" />
                <Text variant="secondary" size="xs" style={{ marginTop: 2 }}>Leave empty for manual-only triggering</Text>
              </EditField>
            )}

            {(node.node_type === "action" || node.node_type === "ignition") && (
              <EditField label="Agent">
                <select style={{ ...inputStyle, cursor: "pointer" }} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  <option value="">No agent assigned</option>
                  {agents.map((a) => <option key={a.agent_id} value={a.agent_id}>{a.name}</option>)}
                </select>
              </EditField>
            )}

            {node.node_type !== "merge" && node.node_type !== "delay" && (
              <EditField label="Prompt">
                <textarea
                  style={{ ...inputStyle, minHeight: 120, resize: "vertical" }}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={
                    node.node_type === "ignition" ? "Initial context or instructions for the workflow"
                    : node.node_type === "condition" ? "Condition to evaluate against upstream output"
                    : "Instructions for the agent to execute"
                  }
                />
              </EditField>
            )}

            {node.node_type === "condition" && (
              <EditField label="Condition Expression">
                <input style={inputStyle} value={conditionExpr} onChange={(e) => setConditionExpr(e.target.value)} placeholder='e.g. output contains "success"' />
              </EditField>
            )}

            {node.node_type === "artifact" && (
              <>
                <EditField label="Artifact Name">
                  <input style={inputStyle} value={artifactName} onChange={(e) => setArtifactName(e.target.value)} placeholder="e.g. Daily Report" />
                </EditField>
                <EditField label="Artifact Type">
                  <select style={{ ...inputStyle, cursor: "pointer" }} value={artifactType} onChange={(e) => setArtifactType(e.target.value)}>
                    <option value="report">Report</option>
                    <option value="data">Data</option>
                    <option value="media">Media</option>
                    <option value="code">Code</option>
                    <option value="custom">Custom</option>
                  </select>
                </EditField>
              </>
            )}

            {node.node_type === "delay" && (
              <EditField label="Delay (seconds)">
                <input style={inputStyle} type="number" min={1} value={delaySeconds} onChange={(e) => setDelaySeconds(e.target.value)} />
              </EditField>
            )}

            {node.node_type === "action" && (
              <EditField label="Vault Path (optional)">
                <input style={inputStyle} value={vaultPath} onChange={(e) => setVaultPath(e.target.value)} placeholder="e.g. Research/" />
                <Text variant="secondary" size="xs" style={{ marginTop: 2 }}>Obsidian vault output folder for publisher nodes</Text>
              </EditField>
            )}

            {node.node_type === "ignition" && (
              <EditField label="Watchlist (JSON)">
                <textarea
                  style={{ ...inputStyle, minHeight: 120, resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 12 }}
                  value={watchlist}
                  onChange={(e) => setWatchlist(e.target.value)}
                  placeholder={'{\n  "sources": [\n    {\n      "name": "Cursor",\n      "signals": {\n        "urls": ["https://cursor.com/blog"],\n        "search_keywords": ["Cursor IDE"]\n      }\n    }\n  ]\n}'}
                />
                <Text variant="secondary" size="xs" style={{ marginTop: 2 }}>Structured monitoring sources for research workflows</Text>
              </EditField>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className={styles.previewHeader}>
        <Text size="sm" className={`${styles.previewTitle} ${styles.previewTitleBold}`}>
          {NODE_TYPE_LABELS[node.node_type]} Config
        </Text>
        <Button variant="ghost" size="sm" iconOnly icon={<Pencil size={14} />} title="Edit" onClick={() => setEditing(true)} />
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
              <Text variant="secondary" size="sm">{node.agent_id || "None"}</Text>
            </div>
          )}

          {node.node_type !== "merge" && node.node_type !== "delay" && node.prompt && (
            <div className={styles.taskField}>
              <span className={styles.fieldLabel}>Prompt</span>
              <Text variant="secondary" size="sm" className={styles.preWrapText}>{node.prompt}</Text>
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
