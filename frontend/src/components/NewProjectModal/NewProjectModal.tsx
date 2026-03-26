import { Modal, Input, Button, Spinner, Text } from "@cypher-asi/zui";
import { useModalInitialFocus } from "../../hooks/use-modal-initial-focus";
import { useNewProjectForm } from "../../hooks/use-new-project-form";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import type { EnvironmentType } from "../../hooks/use-new-project-form";
import styles from "./NewProjectModal.module.css";

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (project: import("../../types").Project) => void;
}

function EnvironmentToggle({
  value,
  onChange,
}: {
  value: EnvironmentType;
  onChange: (env: EnvironmentType) => void;
}) {
  return (
    <div className={styles.fieldGroup}>
      <Text size="sm" className={styles.fieldLabel}>Environment</Text>
      <div className={styles.toggleGroup}>
        <button
          type="button"
          className={value === "remote" ? styles.toggleActive : styles.toggleInactive}
          onClick={() => onChange("remote")}
        >
          Remote
        </button>
        <button
          type="button"
          className={value === "local" ? styles.toggleActive : styles.toggleInactive}
          onClick={() => onChange("local")}
        >
          Local
        </button>
      </div>
    </div>
  );
}

export function NewProjectModal({ isOpen, onClose, onCreated }: NewProjectModalProps) {
  const { inputRef: nameInputRef, initialFocusRef } = useModalInitialFocus<HTMLInputElement>();
  const { isMobileLayout } = useAuraCapabilities();
  const form = useNewProjectForm(isOpen, onClose, onCreated);

  return (
    <Modal
      isOpen={isOpen}
      onClose={form.handleClose}
      title="New Project"
      size="md"
      initialFocusRef={initialFocusRef}
      footer={
        <>
          <Button variant="ghost" onClick={form.handleClose} disabled={form.loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={form.handleSubmit}
            disabled={!form.canSubmit}
          >
            {form.loading ? (
              <><Spinner size="sm" /> Creating...</>
            ) : (
              "Create Project"
            )}
          </Button>
        </>
      }
    >
      <div className={styles.formColumn}>
        <Input
          ref={nameInputRef}
          value={form.name}
          onChange={(e) => {
            form.setName(e.target.value);
            form.setNameError("");
          }}
          onBlur={() => {
            if (!form.name.trim()) form.setNameError("Required");
          }}
          placeholder="Project name"
          validationMessage={form.nameError}
        />

        <div className={styles.fieldGroup}>
          <Text size="sm" className={styles.fieldLabel}>Orbit repo</Text>
          {form.orbitOwner ? (
            <Text variant="muted" size="sm" className={styles.repoPath}>
              orbit/{form.orbitOwner}/{form.proposedRepoSlug}
            </Text>
          ) : (
            <Text variant="muted" size="sm">
              Sign in to create an Orbit repo.
            </Text>
          )}
        </div>

        {isMobileLayout ? (
          <div className={styles.fieldGroup}>
            <Text size="sm" className={styles.fieldLabel}>Environment</Text>
            <Text variant="muted" size="sm">
              Remote only on mobile.
            </Text>
          </div>
        ) : (
          <EnvironmentToggle value={form.environment} onChange={form.setEnvironment} />
        )}

        {form.error && (
          <Text variant="muted" size="sm" className={styles.dangerText}>
            {form.error}
          </Text>
        )}
        {!form.error && form.submitBlocker && (
          <Text variant="muted" size="sm" className={styles.secondaryText}>
            {form.submitBlocker}
          </Text>
        )}
      </div>
    </Modal>
  );
}
