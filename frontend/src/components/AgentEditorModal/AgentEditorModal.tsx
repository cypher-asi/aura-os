import { Modal, Input, Textarea, Button, Spinner, Text } from "@cypher-asi/zui";
import { ImagePlus, X, Monitor, Cloud } from "lucide-react";
import type { Agent } from "../../types";
import { useAgentEditorForm } from "./useAgentEditorForm";
import styles from "./AgentEditorModal.module.css";

interface AgentEditorModalProps {
  isOpen: boolean;
  agent?: Agent;
  onClose: () => void;
  onSaved: (agent: Agent) => void;
}

export function AgentEditorModal({ isOpen, agent, onClose, onSaved }: AgentEditorModalProps) {
  const {
    name, setName, role, setRole, personality, setPersonality,
    systemPrompt, setSystemPrompt, icon, setIcon, machineType, setMachineType,
    saving, error, nameError, setNameError,
    nameRef, initialFocusRef, fileInputRef,
    handleSave, handleClose, handleImageSelect,
  } = useAgentEditorForm(isOpen, agent, onClose, onSaved);

  const isEditing = !!agent;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isEditing ? "Edit Agent" : "Create Agent"}
      size="md"
      initialFocusRef={initialFocusRef}
      footer={
        <div className={styles.footer}>
          <Button variant="ghost" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? <><Spinner size="sm" /> Saving...</> : isEditing ? "Save Changes" : "Create Agent"}
          </Button>
        </div>
      }
    >
      <div className={styles.form}>
        <div className={styles.avatarRow}>
          <button
            type="button"
            className={styles.avatarUpload}
            onClick={() => fileInputRef.current?.click()}
          >
            {icon ? (
              <img src={icon} alt="Agent avatar" className={styles.avatarImg} />
            ) : (
              <ImagePlus size={24} className={styles.avatarPlaceholder} />
            )}
            {icon && (
              <span
                className={styles.avatarRemove}
                onClick={(e) => { e.stopPropagation(); setIcon(""); }}
              >
                <X size={12} />
              </span>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className={styles.hiddenInput}
            onChange={handleImageSelect}
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>Name *</label>
          <Input
            ref={nameRef}
            value={name}
            onChange={(e) => { setName(e.target.value); setNameError(""); }}
            placeholder="e.g. Atlas"
            validationMessage={nameError}
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>Role</label>
          <Input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. Senior Developer"
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>Machine Type</label>
          <div className={styles.machineTypeToggle}>
            <button
              type="button"
              className={`${styles.machineTypeOption} ${machineType === "local" ? styles.machineTypeActive : ""}`}
              onClick={() => setMachineType("local")}
            >
              <Monitor size={14} />
              Local
            </button>
            <button
              type="button"
              className={`${styles.machineTypeOption} ${machineType === "remote" ? styles.machineTypeActive : ""}`}
              onClick={() => setMachineType("remote")}
            >
              <Cloud size={14} />
              Remote
            </button>
          </div>
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>Personality</label>
          <Textarea
            value={personality}
            onChange={(e) => setPersonality(e.target.value)}
            placeholder="e.g. Thorough, opinionated, loves clean code"
            rows={2}
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>System Prompt</label>
          <Textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Instructions for this agent (agents.md content)..."
            rows={6}
            mono
          />
        </div>

        {error && <Text variant="muted" size="sm" className={styles.error}>{error}</Text>}
      </div>
    </Modal>
  );
}
