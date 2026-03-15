import { useState, useEffect, useCallback, useRef } from "react";
import { Modal, Input, Textarea, Button, Spinner, Text } from "@cypher-asi/zui";
import { ImagePlus, X } from "lucide-react";
import { api } from "../api/client";
import type { Agent } from "../types";
import styles from "./AgentEditorModal.module.css";

interface AgentEditorModalProps {
  isOpen: boolean;
  agent?: Agent;
  onClose: () => void;
  onSaved: (agent: Agent) => void;
}

export function AgentEditorModal({ isOpen, agent, onClose, onSaved }: AgentEditorModalProps) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [personality, setPersonality] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [icon, setIcon] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isEditing = !!agent;

  useEffect(() => {
    if (!isOpen) return;
    if (agent) {
      setName(agent.name);
      setRole(agent.role);
      setPersonality(agent.personality);
      setSystemPrompt(agent.system_prompt);
      setIcon(agent.icon ?? "");
    } else {
      setName("");
      setRole("");
      setPersonality("");
      setSystemPrompt("");
      setIcon("");
    }
    setError("");
    setNameError("");
  }, [isOpen, agent]);

  useEffect(() => {
    if (isOpen) requestAnimationFrame(() => nameRef.current?.focus());
  }, [isOpen]);

  const handleClose = useCallback(() => {
    setError("");
    setNameError("");
    setSaving(false);
    onClose();
  }, [onClose]);

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext("2d")!;
      const scale = Math.max(128 / img.width, 128 / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (128 - w) / 2, (128 - h) / 2, w, h);
      setIcon(canvas.toDataURL("image/webp", 0.85));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
    e.target.value = "";
  }, []);

  const handleSave = async () => {
    if (!name.trim()) {
      setNameError("Name is required");
      return;
    }
    setNameError("");
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: name.trim(),
        role: role.trim(),
        personality: personality.trim(),
        system_prompt: systemPrompt.trim(),
        icon: icon || undefined,
      };
      const saved = isEditing
        ? await api.agents.update(agent.agent_id, payload)
        : await api.agents.create({ ...payload, icon: payload.icon ?? "" });
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save agent");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isEditing ? "Edit Agent" : "Create Agent"}
      size="md"
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
