import { useState, useRef, useCallback, useEffect } from "react";
import { Modal, Input, Textarea, Button, Spinner, Text } from "@cypher-asi/zui";
import { api } from "../../../api/client";
import styles from "../components/AgentEditorModal/AgentEditorModal.module.css";

interface SkillEditorModalProps {
  isOpen: boolean;
  /** Name of the user-authored skill to edit; `null` when closed. */
  skillName: string | null;
  onClose: () => void;
  onSaved: () => void;
}

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

/**
 * Frontmatter fields the edit UI does not surface but must round-trip on
 * save. The update endpoint re-renders the whole SKILL.md frontmatter from
 * the request, so any field we don't send back is silently dropped — we
 * load these from the existing skill and pass them straight through.
 */
interface PreservedFields {
  allowed_tools?: string[];
  model?: string;
  context?: string;
  model_invocable: boolean;
}

/**
 * Edit an existing user-authored skill: pre-fills from the skill's current
 * SKILL.md (description / instructions / flags), keeps the name read-only
 * (renaming means delete + recreate), and saves via `updateMySkill`.
 *
 * The body is loaded before any save is allowed because the update handler
 * writes `body.unwrap_or_default()` — saving with an unloaded (empty) body
 * would clobber the user's instructions.
 */
export function SkillEditorModal({ isOpen, skillName, onClose, onSaved }: SkillEditorModalProps) {
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [userInvocable, setUserInvocable] = useState(true);
  const [preserved, setPreserved] = useState<PreservedFields>({ model_invocable: false });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const descRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen || !skillName) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    // Reset fields up front: the modal instance is reused across opens, so a
    // slow or failed load would otherwise leave the *previous* skill's
    // description/instructions in the form (looking like it "pulled up the
    // last skill"). Clearing here guarantees the form only ever shows the
    // skill actually being edited.
    setDescription("");
    setBody("");
    setUserInvocable(true);
    setPreserved({ model_invocable: false });
    api.harnessSkills
      .getSkill(skillName)
      .then((skill) => {
        if (cancelled) return;
        const fm = (skill.frontmatter ?? {}) as Record<string, unknown>;
        setDescription(skill.description ?? "");
        setBody(skill.body ?? "");
        setUserInvocable(skill.user_invocable ?? true);
        setPreserved({
          allowed_tools: Array.isArray(fm.allowed_tools)
            ? (fm.allowed_tools as string[])
            : undefined,
          model: typeof fm.model === "string" ? fm.model : undefined,
          context: typeof fm.context === "string" ? fm.context : undefined,
          model_invocable: skill.model_invocable ?? false,
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(extractApiErrorMessage(err) ?? "Failed to load skill");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, skillName]);

  const handleSave = useCallback(async () => {
    if (!skillName) return;
    setError("");
    if (!description.trim()) {
      setError("Description is required");
      return;
    }

    setSaving(true);
    try {
      await api.harnessSkills.updateMySkill(skillName, {
        description: description.trim(),
        body: body.trim(),
        user_invocable: userInvocable,
        model_invocable: preserved.model_invocable,
        // Round-trip the fields the UI doesn't expose so the update
        // doesn't render a frontmatter that drops them.
        ...(preserved.allowed_tools ? { allowed_tools: preserved.allowed_tools } : {}),
        ...(preserved.model ? { model: preserved.model } : {}),
        ...(preserved.context ? { context: preserved.context } : {}),
      });
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(extractApiErrorMessage(err) ?? "Failed to save skill");
    } finally {
      setSaving(false);
    }
  }, [skillName, description, body, userInvocable, preserved, onSaved, onClose]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={skillName ? `Edit ${skillName}` : "Edit Skill"}
      size="md"
      initialFocusRef={descRef as React.RefObject<HTMLElement>}
      footer={
        <div className={styles.footer}>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving || loading}>
            {saving ? <><Spinner size="sm" /> Saving...</> : "Save Changes"}
          </Button>
        </div>
      }
    >
      <div className={styles.form}>
        {loading ? (
          <div className={styles.fieldGroup}>
            <Text size="sm" variant="muted">
              <Spinner size="sm" /> Loading skill...
            </Text>
          </div>
        ) : (
          <>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Name</label>
              <Input value={skillName ?? ""} disabled />
              <Text size="xs" variant="muted">
                Skill name can't be changed — delete and recreate to rename
              </Text>
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label}>Description *</label>
              <Input
                ref={descRef}
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
          </>
        )}

        {error && <Text variant="muted" size="sm" className={styles.error}>{error}</Text>}
      </div>
    </Modal>
  );
}
