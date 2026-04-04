import { useState, useRef, useCallback } from "react";
import { Modal, Input, Textarea, Button, Spinner, Text } from "@cypher-asi/zui";
import { api } from "../../../api/client";
import styles from "../../../components/AgentEditorModal/AgentEditorModal.module.css";

interface SkillEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const NAME_RE = /^[a-z0-9-]{1,64}$/;

export function SkillEditorModal({ isOpen, onClose, onCreated }: SkillEditorModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [userInvocable, setUserInvocable] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setName("");
    setDescription("");
    setBody("");
    setUserInvocable(true);
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
        body: body.trim(),
        user_invocable: userInvocable,
      });
      onCreated();
      handleClose();
    } catch (err: any) {
      setError(err?.body?.error ?? err?.message ?? "Failed to create skill");
    } finally {
      setSaving(false);
    }
  }, [name, description, body, userInvocable, onCreated, handleClose]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Create Skill"
      size="md"
      initialFocusRef={nameRef as React.RefObject<HTMLElement>}
      footer={
        <div className={styles.footer}>
          <Button variant="ghost" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? <><Spinner size="sm" /> Creating...</> : "Create Skill"}
          </Button>
        </div>
      }
    >
      <div className={styles.form}>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Name *</label>
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

        <div className={styles.fieldGroup}>
          <label className={styles.label}>Description *</label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Deploy the application to production"
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>Instructions</label>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Markdown instructions for this skill..."
            rows={8}
            mono
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>
            <input
              type="checkbox"
              checked={userInvocable}
              onChange={(e) => setUserInvocable(e.target.checked)}
              style={{ marginRight: 6 }}
            />
            User invocable
          </label>
          <Text size="xs" variant="muted">
            Allow users to trigger this skill directly
          </Text>
        </div>

        {error && <Text variant="muted" size="sm" className={styles.error}>{error}</Text>}
      </div>
    </Modal>
  );
}
