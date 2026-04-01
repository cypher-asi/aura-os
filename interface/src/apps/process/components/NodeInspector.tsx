import { useState, useCallback, useEffect } from "react";
import { useParams } from "react-router-dom";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { Button, Text } from "@cypher-asi/zui";
import type { ProcessNode } from "../../../types";
import type { ProcessNodeType } from "../../../types/enums";
import { processApi } from "../../../api/process";
import { useProcessStore } from "../stores/process-store";
import { useAgentStore } from "../../agents/stores";
import { Avatar } from "../../../components/Avatar";

const NODE_TYPE_LABELS: Record<ProcessNodeType, string> = {
  ignition: "Ignition",
  action: "Action",
  condition: "Condition",
  artifact: "Artifact",
  delay: "Delay",
  merge: "Merge",
};

interface NodeInspectorProps {
  node: ProcessNode;
  onClose: () => void;
}

export function NodeInspector({ node, onClose }: NodeInspectorProps) {
  const { processId } = useParams<{ processId: string }>();
  const fetchNodes = useProcessStore((s) => s.fetchNodes);
  const agents = useAgentStore((s) => s.agents);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);

  const [label, setLabel] = useState(node.label);
  const [prompt, setPrompt] = useState(node.prompt);
  const [agentId, setAgentId] = useState(node.agent_id ?? "");
  const [schedule, setSchedule] = useState(
    node.node_type === "ignition" ? (node.config as Record<string, unknown>)?.schedule as string ?? "" : "",
  );
  const [conditionExpr, setConditionExpr] = useState(
    node.node_type === "condition" ? (node.config as Record<string, unknown>)?.condition_expression as string ?? "" : "",
  );
  const [artifactType, setArtifactType] = useState(
    node.node_type === "artifact" ? (node.config as Record<string, unknown>)?.artifact_type as string ?? "report" : "report",
  );
  const [artifactName, setArtifactName] = useState(
    node.node_type === "artifact" ? (node.config as Record<string, unknown>)?.artifact_name as string ?? "" : "",
  );
  const [delaySeconds, setDelaySeconds] = useState(
    node.node_type === "delay" ? String((node.config as Record<string, unknown>)?.delay_seconds ?? "60") : "60",
  );

  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  useEffect(() => {
    setLabel(node.label);
    setPrompt(node.prompt);
    setAgentId(node.agent_id ?? "");
  }, [node]);

  const handleSave = useCallback(async () => {
    if (!processId) return;
    setSaving(true);
    try {
      const config: Record<string, unknown> = { ...node.config as Record<string, unknown> };

      if (node.node_type === "ignition" && schedule) {
        config.schedule = schedule;
      }
      if (node.node_type === "condition") {
        config.condition_expression = conditionExpr;
      }
      if (node.node_type === "artifact") {
        config.artifact_type = artifactType;
        config.artifact_name = artifactName;
      }
      if (node.node_type === "delay") {
        config.delay_seconds = Number(delaySeconds) || 60;
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
      onClose();
    } catch (e) {
      console.error("Failed to save node:", e);
    } finally {
      setSaving(false);
    }
  }, [processId, node, label, prompt, agentId, schedule, conditionExpr, artifactType, artifactName, delaySeconds, fetchNodes, onClose]);

  const handleDelete = useCallback(async () => {
    if (!processId || node.node_type === "ignition") return;
    try {
      await processApi.deleteNode(processId, node.node_id);
      fetchNodes(processId);
      onClose();
    } catch (e) {
      console.error("Failed to delete node:", e);
    }
  }, [processId, node, fetchNodes, onClose]);

  const agent = agentId ? agents.find((a) => a.agent_id === agentId) ?? null : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", borderBottom: "1px solid var(--color-border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Button variant="ghost" size="sm" iconOnly icon={<ArrowLeft size={14} />} onClick={onClose} />
          <Text size="sm" style={{ fontWeight: 600 }}>{NODE_TYPE_LABELS[node.node_type]} Node</Text>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {node.node_type !== "ignition" && (
            <Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={14} />} title="Delete node" onClick={handleDelete} />
          )}
          <Button variant="primary" size="sm" icon={<Save size={14} />} onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Field label="Label">
            <input
              style={inputStyle}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Node label"
            />
          </Field>

          {node.node_type === "ignition" && (
            <Field label="Schedule (cron expression)">
              <input
                style={inputStyle}
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                placeholder="e.g. 0 9 * * * (daily at 9 AM)"
              />
              <span style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 4 }}>
                Leave empty for manual-only triggering
              </span>
            </Field>
          )}

          {(node.node_type === "action" || node.node_type === "ignition") && (
            <Field label="Agent">
              <select
                style={{ ...inputStyle, cursor: "pointer" }}
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
              >
                <option value="">No agent assigned</option>
                {agents.map((a) => (
                  <option key={a.agent_id} value={a.agent_id}>{a.name}</option>
                ))}
              </select>
              {agent && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                  <Avatar avatarUrl={agent.icon ?? undefined} name={agent.name} type="agent" size={20} />
                  <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{agent.name}</span>
                </div>
              )}
            </Field>
          )}

          {node.node_type !== "merge" && node.node_type !== "delay" && (
            <Field label="Prompt">
              <textarea
                style={{ ...inputStyle, minHeight: 120, resize: "vertical" }}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={
                  node.node_type === "ignition"
                    ? "Initial context or instructions for the workflow"
                    : node.node_type === "condition"
                    ? "Condition to evaluate against upstream output"
                    : "Instructions for the agent to execute"
                }
              />
            </Field>
          )}

          {node.node_type === "condition" && (
            <Field label="Condition Expression">
              <input
                style={inputStyle}
                value={conditionExpr}
                onChange={(e) => setConditionExpr(e.target.value)}
                placeholder='e.g. output contains "success"'
              />
            </Field>
          )}

          {node.node_type === "artifact" && (
            <>
              <Field label="Artifact Name">
                <input
                  style={inputStyle}
                  value={artifactName}
                  onChange={(e) => setArtifactName(e.target.value)}
                  placeholder="e.g. Daily Report"
                />
              </Field>
              <Field label="Artifact Type">
                <select
                  style={{ ...inputStyle, cursor: "pointer" }}
                  value={artifactType}
                  onChange={(e) => setArtifactType(e.target.value)}
                >
                  <option value="report">Report</option>
                  <option value="data">Data</option>
                  <option value="media">Media</option>
                  <option value="code">Code</option>
                  <option value="custom">Custom</option>
                </select>
              </Field>
            </>
          )}

          {node.node_type === "delay" && (
            <Field label="Delay (seconds)">
              <input
                style={inputStyle}
                type="number"
                min={1}
                value={delaySeconds}
                onChange={(e) => setDelaySeconds(e.target.value)}
              />
            </Field>
          )}

          <div style={{ fontSize: 11, color: "var(--color-text-muted)", borderTop: "1px solid var(--color-border)", paddingTop: 12, marginTop: 4 }}>
            <div>Node ID: <span style={{ fontFamily: "monospace" }}>{node.node_id}</span></div>
            <div style={{ marginTop: 4 }}>Created: {new Date(node.created_at).toLocaleString()}</div>
            <div style={{ marginTop: 2 }}>Updated: {new Date(node.updated_at).toLocaleString()}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </label>
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
  fontSize: 13,
  fontFamily: "inherit",
  width: "100%",
  outline: "none",
};
