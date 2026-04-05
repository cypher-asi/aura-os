import { useState, useCallback, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { Trash2, Pin, PinOff } from "lucide-react";
import { Modal, Button, Text } from "@cypher-asi/zui";
import type { ProcessNode } from "../../../../types";
import type { ProcessNodeType } from "../../../../types/enums";
import { processApi } from "../../../../api/process";
import { useProcessStore } from "../../stores/process-store";
import { useProcessSidekickStore } from "../../stores/process-sidekick-store";
import { useAgentStore } from "../../../agents/stores";
import { Select } from "../../../../components/Select";
import { SchedulePicker } from "../../../../components/SchedulePicker";
import styles from "../../../../components/Preview/Preview.module.css";

const NODE_TYPE_LABELS: Record<ProcessNodeType, string> = {
  ignition: "Ignition",
  action: "Action",
  condition: "Condition",
  artifact: "Artifact",
  delay: "Delay",
  merge: "Merge",
  prompt: "Prompt",
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

const ARTIFACT_MODE_OPTIONS = [
  { value: "prompt", label: "Prompt" },
  { value: "json_schema", label: "JSON Schema" },
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
  const [artifactMode, setArtifactMode] = useState(
    node.node_type === "artifact" ? (cfg?.artifact_mode as string) ?? "prompt" : "prompt",
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
  const [outputFile, setOutputFile] = useState(
    (node.node_type === "action" || node.node_type === "artifact" || node.node_type === "prompt")
      ? (cfg?.output_file as string) ?? ""
      : "",
  );
  const [watchlist, setWatchlist] = useState(
    node.node_type === "ignition" ? JSON.stringify(cfg?.watchlist ?? {}, null, 2) : "{}",
  );
  const [model, setModel] = useState((cfg?.model as string) ?? "");
  const [timeoutSeconds, setTimeoutSeconds] = useState(
    String(cfg?.timeout_seconds ?? "600"),
  );
  const [maxTurns, setMaxTurns] = useState(
    String(cfg?.max_turns ?? ""),
  );
  const [isPinned, setIsPinned] = useState(!!cfg?.pinned_output);
  const [pinnedOutput, setPinnedOutput] = useState((cfg?.pinned_output as string) ?? "");
  const [pinLoading, setPinLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

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
        setArtifactMode((c?.artifact_mode as string) ?? "prompt");
        setArtifactType((c?.artifact_type as string) ?? "report");
        setArtifactName((c?.artifact_name as string) ?? "");
        setArtifactData(JSON.stringify(c?.data ?? {}, null, 2));
      }
      if (node.node_type === "delay") setDelaySeconds(String(c?.delay_seconds ?? "60"));
      if (node.node_type === "action") setVaultPath((c?.vault_path as string) ?? "");
      if (node.node_type === "action" || node.node_type === "artifact" || node.node_type === "prompt") setOutputFile((c?.output_file as string) ?? "");
      if (node.node_type === "ignition") setWatchlist(JSON.stringify(c?.watchlist ?? {}, null, 2));
      setModel((c?.model as string) ?? "");
      setTimeoutSeconds(String(c?.timeout_seconds ?? "600"));
      setMaxTurns(String(c?.max_turns ?? ""));
      setIsPinned(!!c?.pinned_output);
      setPinnedOutput((c?.pinned_output as string) ?? "");
    }
  }, [isOpen, node]);

  const handlePinToggle = useCallback(async () => {
    if (isPinned) {
      setIsPinned(false);
      setPinnedOutput("");
      return;
    }
    if (pinnedOutput) {
      setIsPinned(true);
      return;
    }
    if (!processId) return;
    setPinLoading(true);
    try {
      const runs = await processApi.listRuns(processId);
      const latestRun = runs[0];
      if (!latestRun) return;
      const events = await processApi.listRunEvents(processId, latestRun.run_id);
      const nodeEvent = events.find(
        (e) => e.node_id === node.node_id && e.status === "completed" && e.output,
      );
      if (nodeEvent?.output) {
        setPinnedOutput(nodeEvent.output);
        setIsPinned(true);
      }
    } finally {
      setPinLoading(false);
    }
  }, [isPinned, pinnedOutput, processId, node.node_id]);

  const handleSave = useCallback(async () => {
    if (!processId) return;
    setSaving(true);
    try {
      const config: Record<string, unknown> = { ...(node.config as Record<string, unknown>) };
      if (node.node_type === "ignition" && schedule) config.schedule = schedule;
      if (node.node_type === "condition") config.condition_expression = conditionExpr;
      if (node.node_type === "artifact") {
        config.artifact_mode = artifactMode;
        config.artifact_type = artifactType;
        config.artifact_name = artifactName;
        if (artifactMode === "json_schema" && artifactData) {
          try { config.data = JSON.parse(artifactData); } catch { /* keep existing */ }
        } else {
          delete config.data;
        }
      }
      if (node.node_type === "delay") config.delay_seconds = Number(delaySeconds) || 60;
      if (node.node_type === "action" && vaultPath) config.vault_path = vaultPath;
      if ((node.node_type === "action" || node.node_type === "artifact" || node.node_type === "prompt") && outputFile) {
        config.output_file = outputFile;
      } else {
        delete config.output_file;
      }
      if (model) config.model = model;
      else delete config.model;
      if (Number(timeoutSeconds) && Number(timeoutSeconds) !== 600) config.timeout_seconds = Number(timeoutSeconds);
      else delete config.timeout_seconds;
      if (maxTurns && Number(maxTurns)) config.max_turns = Number(maxTurns);
      else delete config.max_turns;
      if (isPinned && pinnedOutput) {
        config.pinned_output = pinnedOutput;
      } else {
        delete config.pinned_output;
      }
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
  }, [processId, node, label, prompt, agentId, schedule, conditionExpr, artifactMode, artifactType, artifactName, artifactData, delaySeconds, vaultPath, outputFile, watchlist, model, timeoutSeconds, maxTurns, isPinned, pinnedOutput, fetchNodes, onClose]);

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

  const hasPrompt = node.node_type !== "merge" && node.node_type !== "delay";
  const isLlmNode = ["action", "condition", "artifact", "prompt"].includes(node.node_type);

  const pinToggle = (
    <EditField label="Pin Output">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={handlePinToggle}
          disabled={pinLoading}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 600,
            border: isPinned ? "1px solid #f59e0b40" : "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            background: isPinned ? "rgba(245,158,11,0.1)" : "var(--color-bg-input)",
            color: isPinned ? "#f59e0b" : "var(--color-text-muted)",
            cursor: pinLoading ? "wait" : "pointer",
          }}
        >
          {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
          {pinLoading ? "Loading..." : isPinned ? "Unpin" : "Pin"}
        </button>
        <Text variant="secondary" size="xs">
          {isPinned
            ? "Output is pinned. Node will skip execution and replay this output."
            : "Pin the latest output so this node skips execution on re-runs."}
        </Text>
      </div>
    </EditField>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Edit ${NODE_TYPE_LABELS[node.node_type]} Node`}
      size={hasPrompt ? "xl" : "md"}
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
      {hasPrompt ? (
        <div style={{ display: "flex", gap: 20, minHeight: 400 }}>
          {/* Left column: config fields */}
          <div style={{ width: 320, flexShrink: 0, overflowY: "auto" }} className={styles.taskMeta}>
            <EditField label="Label">
              <input style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Node label" />
            </EditField>

            {node.node_type !== "ignition" && pinToggle}

            {node.node_type === "ignition" && (
              <EditField label="Schedule">
                <SchedulePicker value={schedule} onChange={setSchedule} />
              </EditField>
            )}

            {(node.node_type === "action" || node.node_type === "ignition" || node.node_type === "artifact" || node.node_type === "prompt") && (
              <EditField label="Agent">
                <Select value={agentId} onChange={setAgentId} placeholder="No agent assigned" options={agentOptions} />
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
                <EditField label="Mode">
                  <Select value={artifactMode} onChange={setArtifactMode} options={ARTIFACT_MODE_OPTIONS} />
                  <Text variant="secondary" size="xs" style={{ marginTop: 2 }}>
                    {artifactMode === "prompt"
                      ? "Apply the prompt directly to upstream input."
                      : "Transform upstream input into the target JSON structure."}
                  </Text>
                </EditField>
                {artifactMode === "json_schema" && (
                  <EditField label="Target JSON Shape">
                    <textarea
                      style={{ ...inputStyle, minHeight: 200, resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 12 }}
                      value={artifactData}
                      onChange={(e) => setArtifactData(e.target.value)}
                      placeholder={'{\n  "competitors": [\n    { "name": "...", "website": "...", "summary": "..." }\n  ]\n}'}
                    />
                    <Text variant="secondary" size="xs" style={{ marginTop: 2 }}>The JSON structure the LLM will transform upstream data into.</Text>
                  </EditField>
                )}
              </>
            )}

            {(node.node_type === "action" || node.node_type === "artifact" || node.node_type === "prompt") && (
              <EditField label="Output File">
                <input style={inputStyle} value={outputFile} onChange={(e) => setOutputFile(e.target.value)} placeholder={node.node_type === "artifact" ? "output.md" : "output.txt"} />
                <Text variant="secondary" size="xs" style={{ marginTop: 2 }}>Filename for results in the process workspace.</Text>
              </EditField>
            )}

            {node.node_type === "action" && (
              <EditField label="Vault Path">
                <input style={inputStyle} value={vaultPath} onChange={(e) => setVaultPath(e.target.value)} placeholder="e.g. Research/" />
              </EditField>
            )}

            {node.node_type === "ignition" && (
              <EditField label="Watchlist (JSON)">
                <textarea
                  style={{ ...inputStyle, minHeight: 120, resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 12 }}
                  value={watchlist}
                  onChange={(e) => setWatchlist(e.target.value)}
                  placeholder={'{\n  "sources": [...]\n}'}
                />
              </EditField>
            )}

            {isLlmNode && (
              <>
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 0",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--color-text-muted)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ transform: showAdvanced ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", display: "inline-block" }}>&#9654;</span>
                  Advanced Settings
                </button>
                {showAdvanced && (
                  <>
                    <EditField label="Model">
                      <input style={inputStyle} value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. claude-sonnet-4-20250514" />
                      <Text variant="secondary" size="xs" style={{ marginTop: 2 }}>Override the default model for this node.</Text>
                    </EditField>
                    <EditField label="Timeout (seconds)">
                      <input style={inputStyle} type="number" min={30} value={timeoutSeconds} onChange={(e) => setTimeoutSeconds(e.target.value)} placeholder="600" />
                    </EditField>
                    <EditField label="Max Turns">
                      <input style={inputStyle} type="number" min={1} value={maxTurns} onChange={(e) => setMaxTurns(e.target.value)} placeholder="Auto" />
                      <Text variant="secondary" size="xs" style={{ marginTop: 2 }}>Limit the number of LLM turns in the session.</Text>
                    </EditField>
                  </>
                )}
              </>
            )}
          </div>

          {/* Right column: prompt editor */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <span className={styles.fieldLabel}>Prompt</span>
            <textarea
              style={{
                ...inputStyle,
                flex: 1,
                minHeight: 300,
                resize: "none",
              }}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                node.node_type === "ignition" ? "Initial context or instructions for the workflow"
                : node.node_type === "condition" ? "Condition to evaluate against upstream output"
                : node.node_type === "prompt" ? "Instructions for the prompt to execute and produce an artifact"
                : "Instructions for the agent to execute"
              }
            />
          </div>
        </div>
      ) : (
        <div className={styles.taskMeta}>
          <EditField label="Label">
            <input style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Node label" />
          </EditField>

          {pinToggle}

          {node.node_type === "delay" && (
            <EditField label="Delay (seconds)">
              <input style={inputStyle} type="number" min={1} value={delaySeconds} onChange={(e) => setDelaySeconds(e.target.value)} />
            </EditField>
          )}
        </div>
      )}
    </Modal>
  );
}
