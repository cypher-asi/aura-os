import { useState, useCallback, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { Trash2, Pin, PinOff } from "lucide-react";
import { Modal, ModalConfirm, Button, Text } from "@cypher-asi/zui";
import type { ProcessNode } from "../../../../types";
import type { ProcessNodeType } from "../../../../types/enums";
import { processApi } from "../../../../api/process";
import { useProcessStore } from "../../stores/process-store";
import { useProcessSidekickStore } from "../../stores/process-sidekick-store";
import { useAgentStore } from "../../../agents/stores";
import { Select } from "../../../../components/Select";
import { SchedulePicker } from "../../../../components/SchedulePicker";
import { CHAT_MODEL_OPTIONS } from "../../../../constants/models";
import previewStyles from "../../../../components/Preview/Preview.module.css";
import modalStyles from "./NodeEditorModal.module.css";

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
  group: "Group",
};

interface NodeEditorModalProps {
  isOpen: boolean;
  node: ProcessNode;
  onClose: () => void;
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={previewStyles.taskField}>
      <span className={previewStyles.fieldLabel}>{label}</span>
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
  const [childProcessId, setChildProcessId] = useState(
    (node.node_type === "sub_process" || node.node_type === "for_each")
      ? (cfg?.child_process_id as string) ?? ""
      : "",
  );
  const [maxConcurrency, setMaxConcurrency] = useState(
    node.node_type === "for_each" ? String(cfg?.max_concurrency ?? "3") : "3",
  );
  const [iteratorMode, setIteratorMode] = useState(
    node.node_type === "for_each" ? (cfg?.iterator_mode as string) ?? "json_array" : "json_array",
  );
  const [itemVariableName, setItemVariableName] = useState(
    node.node_type === "for_each" ? (cfg?.item_variable_name as string) ?? "item" : "item",
  );
  const [jsonArrayKey, setJsonArrayKey] = useState(
    node.node_type === "for_each" ? (cfg?.json_array_key as string) ?? "entries" : "entries",
  );
  const [collectMode, setCollectMode] = useState(
    node.node_type === "for_each" ? (cfg?.collect_mode as string) ?? "json_array" : "json_array",
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [processes, setProcesses] = useState<Array<{ process_id: string; name: string }>>([]);
  useEffect(() => {
    if (node.node_type === "sub_process" || node.node_type === "for_each") {
      processApi.listProcesses().then(setProcesses).catch(() => {});
    }
  }, [node.node_type]);

  const processOptions = useMemo(
    () => [
      { value: "", label: "Select a process..." },
      ...processes
        .filter((p) => p.process_id !== processId)
        .map((p) => ({ value: p.process_id, label: p.name })),
    ],
    [processes, processId],
  );

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
      if (node.node_type === "sub_process" || node.node_type === "for_each") {
        setChildProcessId((c?.child_process_id as string) ?? "");
      }
      if (node.node_type === "for_each") {
        setMaxConcurrency(String(c?.max_concurrency ?? "3"));
        setIteratorMode((c?.iterator_mode as string) ?? "json_array");
        setItemVariableName((c?.item_variable_name as string) ?? "item");
        setJsonArrayKey((c?.json_array_key as string) ?? "entries");
        setCollectMode((c?.collect_mode as string) ?? "json_array");
      }
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
      if (node.node_type === "sub_process" || node.node_type === "for_each") {
        if (childProcessId) config.child_process_id = childProcessId;
      }
      if (node.node_type === "for_each") {
        config.max_concurrency = Number(maxConcurrency) || 3;
        config.iterator_mode = iteratorMode;
        if (itemVariableName) config.item_variable_name = itemVariableName;
        if (jsonArrayKey.trim()) config.json_array_key = jsonArrayKey.trim();
        else delete config.json_array_key;
        config.collect_mode = collectMode;
      }
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
  }, [processId, node, label, prompt, agentId, schedule, conditionExpr, artifactMode, artifactType, artifactName, artifactData, delaySeconds, childProcessId, maxConcurrency, iteratorMode, itemVariableName, jsonArrayKey, collectMode, outputFile, watchlist, model, timeoutSeconds, maxTurns, isPinned, pinnedOutput, fetchNodes, onClose]);

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

  const hasPrompt = node.node_type !== "merge" && node.node_type !== "delay" && node.node_type !== "group";
  const isLlmNode = ["action", "condition", "artifact", "prompt"].includes(node.node_type);

  const pinButtonLabel = isPinned ? "Unpin" : "Pin";
  const pinToggle = node.node_type !== "ignition" && node.node_type !== "group" ? (
    <EditField label="Pin Output">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={handlePinToggle}
          disabled={pinLoading}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 600,
            border: "1px solid",
            borderColor: isPinned ? "#f59e0b40" : "var(--color-border)",
            borderRadius: "var(--radius-sm)",
            background: isPinned ? "rgba(245,158,11,0.1)" : "var(--color-bg-input)",
            color: isPinned ? "#f59e0b" : "var(--color-text-muted)",
            cursor: "pointer",
            transition: "background-color 0.16s ease, border-color 0.16s ease, color 0.16s ease",
            boxSizing: "border-box",
            position: "relative",
          }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              visibility: "hidden",
              pointerEvents: "none",
            }}
          >
            <PinOff size={13} />
            Unpin
          </span>
          <span
            style={{
              position: "absolute",
              inset: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
            {pinButtonLabel}
          </span>
        </button>
        <Text variant="secondary" size="xs">
          {isPinned
            ? "Output is pinned. Node will skip execution and replay this output."
            : "Pin the latest output so this node skips execution on re-runs."}
        </Text>
      </div>
    </EditField>
  ) : null;

  const footer = (
    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center", width: "100%" }}>
      {node.node_type !== "ignition" && (
        <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => setShowDeleteConfirm(true)} style={{ marginRight: "auto" }}>
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
  );

  const deleteConfirmModal = (
    <ModalConfirm
      isOpen={showDeleteConfirm}
      onClose={() => setShowDeleteConfirm(false)}
      onConfirm={() => { setShowDeleteConfirm(false); handleDelete(); }}
      title="Delete Node"
      message="Are you sure you want to delete this node? This action cannot be undone."
      confirmLabel="Delete"
      danger
    />
  );

  if (!hasPrompt) {
    return (
      <>
        <Modal isOpen={isOpen} onClose={onClose} title={`Edit ${NODE_TYPE_LABELS[node.node_type]} Node`} size="md" footer={footer}>
          <div className={previewStyles.taskMeta}>
            <EditField label="Label">
              <input style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Node label" />
            </EditField>

            {node.node_type === "delay" && (
              <EditField label="Delay (seconds)">
                <input style={inputStyle} type="number" min={1} value={delaySeconds} onChange={(e) => setDelaySeconds(e.target.value)} />
              </EditField>
            )}
            {pinToggle}
          </div>
        </Modal>
        {deleteConfirmModal}
      </>
    );
  }

  return (
    <>
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Edit ${NODE_TYPE_LABELS[node.node_type]} Node`}
      size="xl"
      fullHeight
      noPadding
      className={modalStyles.wideModal}
      footer={footer}
    >
      <div className={modalStyles.twoColumn}>
        {/* Left column: config fields */}
        <div className={modalStyles.leftColumn}>
          <EditField label="Label">
            <input style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Node label" />
          </EditField>

          {(node.node_type === "sub_process" || node.node_type === "for_each") && (
            <EditField label="Child Process">
              <Select value={childProcessId} onChange={setChildProcessId} placeholder="Select a process..." options={processOptions} />
              <Text variant="secondary" size="xs" style={{ marginTop: 2 }}>The process to invoke for each item or as a sub-process.</Text>
            </EditField>
          )}

          {node.node_type === "for_each" && (
            <>
              <EditField label="Iterator Mode">
                <Select
                  value={iteratorMode}
                  onChange={setIteratorMode}
                  options={[
                    { value: "json_array", label: "JSON Array" },
                    { value: "line_delimited", label: "Line Delimited" },
                    { value: "separator", label: "Custom Separator" },
                  ]}
                />
              </EditField>
              <EditField label="Max Concurrency">
                <input style={inputStyle} type="number" min={1} max={20} value={maxConcurrency} onChange={(e) => setMaxConcurrency(e.target.value)} />
                <Text variant="secondary" size="xs" style={{ marginTop: 2 }}>Maximum parallel child process runs.</Text>
              </EditField>
              <EditField label="Item Variable Name">
                <input style={inputStyle} value={itemVariableName} onChange={(e) => setItemVariableName(e.target.value)} placeholder="item" />
              </EditField>
              {iteratorMode === "json_array" && (
                <EditField label="JSON Array Key">
                  <input style={inputStyle} value={jsonArrayKey} onChange={(e) => setJsonArrayKey(e.target.value)} placeholder="entries" />
                  <Text variant="secondary" size="xs" style={{ marginTop: 2 }}>
                    If upstream is a JSON object, read the iterable array from this key. Defaults to <code>entries</code>.
                  </Text>
                </EditField>
              )}
              <EditField label="Collect Mode">
                <Select
                  value={collectMode}
                  onChange={setCollectMode}
                  options={[
                    { value: "json_array", label: "JSON Array" },
                    { value: "concatenate", label: "Concatenated Text" },
                  ]}
                />
              </EditField>
            </>
          )}

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

          {pinToggle}

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
                    <Select value={model} onChange={setModel} placeholder="Default" options={CHAT_MODEL_OPTIONS} />
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

        {/* Right column: prompt editor — fills edge-to-edge */}
        <div className={modalStyles.rightColumn}>
          <textarea
            className={modalStyles.promptTextarea}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              node.node_type === "ignition" ? "Initial context or instructions for the workflow..."
              : node.node_type === "condition" ? "Condition to evaluate against upstream output..."
              : node.node_type === "prompt" ? "Instructions for the prompt to execute and produce an artifact..."
              : "Instructions for the agent to execute..."
            }
          />
        </div>
      </div>
    </Modal>
    {deleteConfirmModal}
    </>
  );
}
