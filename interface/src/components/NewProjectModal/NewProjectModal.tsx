import { Modal, Input, Button, Spinner, Text } from "@cypher-asi/zui";
import { useModalInitialFocus } from "../../hooks/use-modal-initial-focus";
import { useNewProjectForm } from "../../hooks/use-new-project-form";
import {
  joinWorkspacePath,
  useWorkspaceRoot,
} from "../../hooks/use-workspace-defaults";
import { FolderPickerField } from "../FolderPickerField";
import styles from "./NewProjectModal.module.css";

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (project: import("../../shared/types").Project) => void;
}

export function NewProjectModal({ isOpen, onClose, onCreated }: NewProjectModalProps) {
  const { inputRef: nameInputRef, initialFocusRef } = useModalInitialFocus<HTMLInputElement>();
  const form = useNewProjectForm(isOpen, onClose, onCreated);
  const workspaceRoot = useWorkspaceRoot();
  const defaultWorkspacePath = workspaceRoot
    ? joinWorkspacePath(workspaceRoot, "<new-project-id>")
    : "";

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

        <FolderPickerField
          label="Local workspace folder (optional)"
          value={form.localWorkspacePath}
          onChange={form.setLocalWorkspacePath}
          disabled={form.loading}
          defaultPath={defaultWorkspacePath}
        />

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
