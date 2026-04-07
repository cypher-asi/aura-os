import { useParams } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { Modal, ModalConfirm, Button, Text } from "@cypher-asi/zui";
import type { ProcessNode } from "../../../../types";
import { Select } from "../../../../components/Select";
import { SchedulePicker } from "../../../../components/SchedulePicker";
import { CHAT_MODEL_OPTIONS, DEFAULT_MODEL } from "../../../../constants/models";
import previewStyles from "../../../../components/Preview/Preview.module.css";
import modalStyles from "./NodeEditorModal.module.css";
import {
  ARTIFACT_MODE_OPTIONS,
  ARTIFACT_TYPE_OPTIONS,
  inputStyle,
  NODE_TYPE_LABELS,
} from "./node-editor-modal-constants";
import { NodeEditorEditField } from "./node-editor-modal-edit-field";
import { NodeEditorModalPinToggle } from "./NodeEditorModalPinToggle";
import { useNodeEditorModal } from "./useNodeEditorModal";

interface NodeEditorModalProps {
  isOpen: boolean;
  node: ProcessNode;
  onClose: () => void;
}

export function NodeEditorModal({ isOpen, node, onClose }: NodeEditorModalProps) {
  const { processId } = useParams<{ processId: string }>();
  const m = useNodeEditorModal({ isOpen, node, processId, onClose });

  const pinToggle = node.node_type !== "ignition" && node.node_type !== "group" ? (
    <NodeEditorModalPinToggle
      isPinned={m.isPinned}
      pinLoading={m.pinLoading}
      onPinClick={m.handlePinToggle}
    />
  ) : null;

  const footer = (
    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center", width: "100%" }}>
      {node.node_type !== "ignition" && (
        <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => m.setShowDeleteConfirm(true)} style={{ marginRight: "auto" }}>
          Delete
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={onClose} disabled={m.saving}>
        Cancel
      </Button>
      <Button variant="primary" size="sm" onClick={m.handleSave} disabled={m.saving}>
        {m.saving ? "Saving..." : "Save Changes"}
      </Button>
    </div>
  );

  const deleteConfirmModal = (
    <ModalConfirm
      isOpen={m.showDeleteConfirm}
      onClose={() => m.setShowDeleteConfirm(false)}
      onConfirm={() => { m.setShowDeleteConfirm(false); m.handleDelete(); }}
      title="Delete Node"
      message="Are you sure you want to delete this node? This action cannot be undone."
      confirmLabel="Delete"
      danger
    />
  );

  if (!m.hasPrompt) {
    return (
      <>
        <Modal isOpen={isOpen} onClose={onClose} title={`Edit ${NODE_TYPE_LABELS[node.node_type]} Node`} size="md" footer={footer}>
          <div className={previewStyles.taskMeta}>
            <NodeEditorEditField label="Label">
              <input style={inputStyle} value={m.label} onChange={(e) => m.setLabel(e.target.value)} placeholder="Node label" />
            </NodeEditorEditField>

            {node.node_type === "delay" && (
              <NodeEditorEditField label="Delay (seconds)">
                <input style={inputStyle} type="number" min={1} value={m.delaySeconds} onChange={(e) => m.setDelaySeconds(e.target.value)} />
              </NodeEditorEditField>
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
          <div className={modalStyles.leftColumn}>
            <NodeEditorEditField label="Label">
              <input style={inputStyle} value={m.label} onChange={(e) => m.setLabel(e.target.value)} placeholder="Node label" />
            </NodeEditorEditField>

            {(node.node_type === "sub_process" || node.node_type === "for_each") && (
              <NodeEditorEditField label="Child Process">
                <Select value={m.childProcessId} onChange={m.setChildProcessId} placeholder="Select a process..." options={m.processOptions} />
                <Text variant="secondary" size="xs" style={{ marginTop: 2 }}>The process to invoke for each item or as a sub-process.</Text>
              </NodeEditorEditField>
            )}

            {node.node_type === "for_each" && (
              <>
                <NodeEditorEditField label="Iterator Mode">
                  <Select
                    value={m.iteratorMode}
                    onChange={m.setIteratorMode}
                    options={[
                      { value: "json_array", label: "JSON Array" },
                      { value: "line_delimited", label: "Line Delimited" },
                      { value: "separator", label: "Custom Separator" },
                    ]}
                  />
                </NodeEditorEditField>
                <NodeEditorEditField label="Max Concurrency">
                  <input style={inputStyle} type="number" min={1} max={20} value={m.maxConcurrency} onChange={(e) => m.setMaxConcurrency(e.target.value)} />
                  <Text variant="secondary" size="xs" style={{ marginTop: 2 }}>Maximum parallel child process runs.</Text>
                </NodeEditorEditField>
                <NodeEditorEditField label="Max Items">
                  <input style={inputStyle} type="number" min={1} value={m.maxItems} onChange={(e) => m.setMaxItems(e.target.value)} placeholder="Unlimited" />
                  <Text variant="secondary" size="xs" style={{ marginTop: 2 }}>Optionally stop after the first N parsed items.</Text>
                </NodeEditorEditField>
                <NodeEditorEditField label="Item Variable Name">
                  <input style={inputStyle} value={m.itemVariableName} onChange={(e) => m.setItemVariableName(e.target.value)} placeholder="item" />
                </NodeEditorEditField>
                {m.iteratorMode === "json_array" && (
                  <NodeEditorEditField label="JSON Array Key">
                    <input style={inputStyle} value={m.jsonArrayKey} onChange={(e) => m.setJsonArrayKey(e.target.value)} placeholder="entries" />
                    <Text variant="secondary" size="xs" style={{ marginTop: 2 }}>
                      If upstream is a JSON object, read the iterable array from this key. Defaults to <code>entries</code>.
                    </Text>
                  </NodeEditorEditField>
                )}
                <NodeEditorEditField label="Collect Mode">
                  <Select
                    value={m.collectMode}
                    onChange={m.setCollectMode}
                    options={[
                      { value: "json_array", label: "JSON Array" },
                      { value: "concatenate", label: "Concatenated Text" },
                    ]}
                  />
                </NodeEditorEditField>
              </>
            )}

            {node.node_type === "ignition" && (
              <NodeEditorEditField label="Schedule">
                <SchedulePicker value={m.schedule} onChange={m.setSchedule} />
              </NodeEditorEditField>
            )}

            {m.isRuntimeBackedNode && (
              <NodeEditorEditField label="Agent">
                <Select value={m.agentId} onChange={m.setAgentId} placeholder="No agent assigned" options={m.agentOptions} />
                <Text variant="secondary" size="xs" style={{ marginTop: 2 }}>
                  Required for runtime-backed process nodes to create a per-node session.
                </Text>
              </NodeEditorEditField>
            )}

            {m.isRuntimeBackedNode && (
              <NodeEditorEditField label="Model">
                <Select value={m.model} onChange={m.setModel} placeholder={DEFAULT_MODEL.label} options={CHAT_MODEL_OPTIONS} />
                <Text variant="secondary" size="xs" style={{ marginTop: 2 }}>
                  Reuses the chat model picker. Leaving this unset defaults the node session to {DEFAULT_MODEL.label}.
                </Text>
              </NodeEditorEditField>
            )}

            {node.node_type === "condition" && (
              <NodeEditorEditField label="Condition Expression">
                <input style={inputStyle} value={m.conditionExpr} onChange={(e) => m.setConditionExpr(e.target.value)} placeholder='e.g. output contains "success"' />
              </NodeEditorEditField>
            )}

            {node.node_type === "artifact" && (
              <>
                <NodeEditorEditField label="Artifact Name">
                  <input style={inputStyle} value={m.artifactName} onChange={(e) => m.setArtifactName(e.target.value)} placeholder="e.g. Daily Report" />
                </NodeEditorEditField>
                <NodeEditorEditField label="Artifact Type">
                  <Select value={m.artifactType} onChange={m.setArtifactType} options={[...ARTIFACT_TYPE_OPTIONS]} />
                </NodeEditorEditField>
                <NodeEditorEditField label="Mode">
                  <Select value={m.artifactMode} onChange={m.setArtifactMode} options={[...ARTIFACT_MODE_OPTIONS]} />
                  <Text variant="secondary" size="xs" style={{ marginTop: 2 }}>
                    {m.artifactMode === "prompt"
                      ? "Apply the prompt directly to upstream input."
                      : "Transform upstream input into the target JSON structure."}
                  </Text>
                </NodeEditorEditField>
                {m.artifactMode === "json_schema" && (
                  <NodeEditorEditField label="Target JSON Shape">
                    <textarea
                      style={{ ...inputStyle, minHeight: 200, resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 12 }}
                      value={m.artifactData}
                      onChange={(e) => m.setArtifactData(e.target.value)}
                      placeholder={'{\n  "competitors": [\n    { "name": "...", "website": "...", "summary": "..." }\n  ]\n}'}
                    />
                    <Text variant="secondary" size="xs" style={{ marginTop: 2 }}>The JSON structure the LLM will transform upstream data into.</Text>
                  </NodeEditorEditField>
                )}
              </>
            )}

            {(node.node_type === "action" || node.node_type === "artifact" || node.node_type === "prompt") && (
              <NodeEditorEditField label="Output File">
                <input style={inputStyle} value={m.outputFile} onChange={(e) => m.setOutputFile(e.target.value)} placeholder={node.node_type === "artifact" ? "output.md" : "output.txt"} />
                <Text variant="secondary" size="xs" style={{ marginTop: 2 }}>Filename for results in the process workspace.</Text>
              </NodeEditorEditField>
            )}

            {node.node_type === "ignition" && (
              <NodeEditorEditField label="Watchlist (JSON)">
                <textarea
                  style={{ ...inputStyle, minHeight: 120, resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 12 }}
                  value={m.watchlist}
                  onChange={(e) => m.setWatchlist(e.target.value)}
                  placeholder={'{\n  "sources": [...]\n}'}
                />
              </NodeEditorEditField>
            )}

            {pinToggle}

            {m.isLlmNode && (
              <>
                <button
                  onClick={() => m.setShowAdvanced(!m.showAdvanced)}
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
                  <span style={{ transform: m.showAdvanced ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", display: "inline-block" }}>&#9654;</span>
                  Advanced Settings
                </button>
                {m.showAdvanced && (
                  <>
                    <NodeEditorEditField label="Timeout (seconds)">
                      <input style={inputStyle} type="number" min={30} value={m.timeoutSeconds} onChange={(e) => m.setTimeoutSeconds(e.target.value)} placeholder="600" />
                    </NodeEditorEditField>
                    <NodeEditorEditField label="Max Turns">
                      <input style={inputStyle} type="number" min={1} value={m.maxTurns} onChange={(e) => m.setMaxTurns(e.target.value)} placeholder="Auto" />
                      <Text variant="secondary" size="xs" style={{ marginTop: 2 }}>Limit the number of LLM turns in the session.</Text>
                    </NodeEditorEditField>
                  </>
                )}
              </>
            )}
          </div>

          <div className={modalStyles.rightColumn}>
            <textarea
              className={modalStyles.promptTextarea}
              value={m.prompt}
              onChange={(e) => m.setPrompt(e.target.value)}
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
