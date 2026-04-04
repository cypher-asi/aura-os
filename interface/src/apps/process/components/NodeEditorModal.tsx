import { useState, useCallback, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { Modal, Button, Text } from "@cypher-asi/zui";
import type { ProcessNode } from "../../../types";
import type { ProcessNodeType } from "../../../types/enums";
import { processApi } from "../../../api/process";
import { useProcessStore } from "../stores/process-store";
import { useProcessSidekickStore } from "../stores/process-sidekick-store";
import { useAgentStore } from "../../agents/stores";
import { Select } from "../../../components/Select";
import { SchedulePicker } from "../../../components/SchedulePicker";
import styles from "../../../components/Preview/Preview.module.css";

const NODE_TYPE_LABELS: Record<ProcessNodeType, string> = {
  ignition: "Ignition",
  action: "Action",
  condition: "Condition",
  artifact: "Artifact",
  delay: "Delay",
  merge: "Merge",
};

interface NodeEditorModalProps {
  isOpen: boolean;
  node: ProcessNode;
  onClose: () => void;
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

const ARTIFACT_TYPE_OPTIONS = [
  { value: "report", label: "Report" },
  { value: "data", label: "Data" },
  { value: "media", label: "Media" },
  { value: "code", label: "Code" },
  { value: "custom", label: "Custom" },
];

export function NodeEditorModal({ isOpen, node, onClose }: NodeEditorModalProps) {
  const { processId } = useParams<{ processId: string }>();
  const fetchNodes = useProcessStore((s) => s.fetchNodes);
  const closeNodeInspector = useProcessSidekickStore((s) => s.closeNodeInspector);
  const agents = useAgentStore((s) => s.agents);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);

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
  const [artifactData, setArtifactData] = useState(
    node.node_type === "artifact" ? JSON.stringify(cfg?.data ?? {}, null, 2) : "{}",
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

  const agentOptions = useMemo(
    () => [
      { value: "", label: "No agent assigned" },
      ...agents.map((a) => ({ value: a.agent_id, label: a.name })),
    ],
    [agents],
  );

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  useEffect(() => {
    if (isOpen) {
      setLabel(node.label);
      setPrompt(node.prompt);
      setAgentId(node.agent_id ?? "");
      setSaving(false);
      const c = node.config as Record<string, unknown>;
      if (node.node_type === "ignition") setSchedule((c?.schedule as string) ?? "");
      if (node.node_type === "condition") setConditionExpr((c?.condition_expression as string) ?? "");
      if (node.node_type === "artifact") {
        setArtifactType((c?.artifact_type as string) ?? "report");
        setArtifactName((c?.artifact_name as string) ?? "");
        setArtifactData(JSON.stringify(c?.data ?? {}, null, 2));
      }
      if (node.node_type === "delay") setDelaySeconds(String(c?.delay_seconds ?? "60"));
      if (node.node_type === "action") setVaultPath((c?.vault_path as string) ?? "");
      if (node.node_type === "ignition") setWatchlist(JSON.stringify(c?.watchlist ?? {}, null, 2));
    }
  }, [isOpen, node]);

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
        if (artifactData) {
          try { config.data = JSON.parse(artifactData); } catch { /* keep existing */ }
        }
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
      onClose();
    } catch (e) {
      console.error("Failed to save node:", e);
    } finally {
      setSaving(false);
    }
  }, [processId, node, label, prompt, agentId, schedule, conditionExpr, artifactType, artifactName, artifactData, delaySeconds, vaultPath, watchlist, fetchNodes, onClose]);

  const handleDelete = useCallback(async () => {
    if (!processId || node.node_type === "ignition") return;
    try {
      await processApi.deleteNode(processId, node.node_id);
      fetchNodes(processId);
      closeNodeInspector();
      onClose();
    } catch (e) {
      console.error("Failed to delete node:", e);
    }
  }, [processId, node, fetchNodes, closeNodeInspector, onClose]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Edit ${NODE_TYPE_LABELS[node.node_type]} Node`}
      size="md"
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          {node.node_type !== "ignition" && (
            <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={handleDelete} style={{ marginRight: "auto" }}>
              Delete
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      }
    >
      <div className={styles.taskMeta}>
        <EditField label="Label">
          <input style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Node label" />
        </EditField>

        {node.node_type === "ignition" && (
          <EditField label="Schedule">
            <SchedulePicker value={schedule} onChange={setSchedule} />
          </EditField>
        )}

        {(node.node_type === "action" || node.node_type === "ignition" || node.node_type === "artifact") && (
          <EditField label="Agent">
            <Select
              value={agentId}
              onChange={setAgentId}
              placeholder="No agent assigned"
              options={agentOptions}
            />
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
              <Select value={artifactType} onChange={setArtifactType} options={ARTIFACT_TYPE_OPTIONS} />
            </EditField>
            <EditField label="Data (JSON)">
              <textarea
                style={{ ...inputStyle, minHeight: 200, resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 12 }}
                value={artifactData}
                onChange={(e) => setArtifactData(e.target.value)}
                placeholder={'{\n  "competitors": {\n    "Cursor": { "website": "https://cursor.com" }\n  }\n}'}
              />
              <Text variant="secondary" size="xs" style={{ marginTop: 2 }}>Static JSON data for this artifact. Merged with upstream output when both are present.</Text>
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
    </Modal>
  );
}
