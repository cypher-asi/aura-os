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

/**
 * Pull a user-facing message off an unknown rejection. The harness API
 * surfaces structured failures as `{ body: { error?, message? } }`, but
 * networking / runtime errors fall through to a plain `Error.message`.
 */
function extractApiErrorMessage(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as { body?: { error?: unknown; message?: unknown }; message?: unknown };
  if (typeof e.body?.error === "string") return e.body.error;
  if (typeof e.body?.message === "string") return e.body.message;
  if (typeof e.message === "string") return e.message;
  return undefined;
}

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
    } catch (err: unknown) {
      setError(extractApiErrorMessage(err) ?? "Failed to create skill");
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
