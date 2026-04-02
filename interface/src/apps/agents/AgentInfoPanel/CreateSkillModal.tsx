import { useState, useRef, useCallback } from "react";
import { Modal, Input, Button, Text } from "@cypher-asi/zui";
import { api } from "../../../api/client";

interface CreateSkillModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const NAME_RE = /^[a-z0-9-]{1,64}$/;

export function CreateSkillModal({ isOpen, onClose, onCreated }: CreateSkillModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setName("");
    setDescription("");
    setBody("");
    setSaving(false);
    setError("");
    setNameError("");
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleSave = useCallback(async () => {
    setError("");
    setNameError("");

    const slug = name.trim().toLowerCase().replace(/\s+/g, "-");
    if (!slug) {
      setNameError("Name is required");
      nameRef.current?.focus();
      return;
    }
    if (!NAME_RE.test(slug)) {
      setNameError("Lowercase letters, digits, and hyphens only (1-64 chars)");
      nameRef.current?.focus();
      return;
    }
    if (!description.trim()) {
      setError("Description is required");
      return;
    }

    setSaving(true);
    try {
      await api.harnessSkills.createSkill({
        name: slug,
        description: description.trim(),
        body: body.trim() || undefined,
      });
      onCreated();
      handleClose();
    } catch (err: any) {
      setError(err?.body?.error ?? err?.message ?? "Failed to create skill");
    } finally {
      setSaving(false);
    }
  }, [name, description, body, onCreated, handleClose]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Create Skill"
      size="md"
      initialFocusRef={nameRef as React.RefObject<HTMLElement>}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Creating..." : "Create Skill"}
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <Text size="xs" weight="medium">Name *</Text>
          <Input
            ref={nameRef}
            value={name}
            onChange={(e) => { setName(e.target.value); setNameError(""); }}
            placeholder="e.g. deploy"
            validationMessage={nameError}
          />
          <Text size="xs" variant="muted">
            Lowercase letters, digits, and hyphens only
          </Text>
        </div>

        <div>
          <Text size="xs" weight="medium">Description *</Text>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Deploy the application to production"
          />
        </div>

        <div>
          <Text size="xs" weight="medium">Instructions</Text>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Markdown instructions for this skill..."
            rows={8}
            style={{
              width: "100%",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 13,
              padding: 8,
              borderRadius: 4,
              border: "1px solid var(--color-border)",
              background: "var(--color-bg-input, transparent)",
              color: "var(--color-text)",
              resize: "vertical",
            }}
          />
        </div>

        {error && (
          <Text variant="muted" size="sm" style={{ color: "var(--color-danger, #ef4444)" }}>
            {error}
          </Text>
        )}
      </div>
    </Modal>
  );
}
