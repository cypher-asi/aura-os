import { Modal, Input, Button, Spinner, Text } from "@cypher-asi/zui";
import { PathInput } from "./PathInput";
import { useAuraCapabilities } from "../hooks/use-aura-capabilities";
import { useModalInitialFocus } from "../hooks/use-modal-initial-focus";
import { useNewProjectForm } from "../hooks/use-new-project-form";
import { WorkspaceModeSection, ImportFilesSection } from "./WorkspaceModeSection";
import { OrbitRepoSection } from "./OrbitRepoSection";

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (project: import("../types").Project) => void;
}

export function NewProjectModal({ isOpen, onClose, onCreated }: NewProjectModalProps) {
  const { features } = useAuraCapabilities();
  const { inputRef: nameInputRef, initialFocusRef } = useModalInitialFocus<HTMLInputElement>();
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
            ) : form.needsImportedFiles ? (
              "Choose Files to Continue"
            ) : form.needsLinkedFolder ? (
              "Choose Folder to Continue"
            ) : (
              "Create Project"
            )}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <WorkspaceModeSection
          workspaceMode={form.workspaceMode}
          onSelect={form.setWorkspaceMode}
          options={form.workspaceModeOptions}
          showPicker={form.showWorkspaceModePicker}
        />

        <Input
          ref={nameInputRef}
          value={form.name}
          onChange={(e) => {
            form.setName(e.target.value);
            form.setNameError("");
          }}
          placeholder="Project name"
          validationMessage={form.nameError}
        />
        <Input
          value={form.description}
          onChange={(e) => form.setDescription(e.target.value)}
          placeholder="Description (optional)"
        />

        {form.workspaceMode === "linked" ? (
          <>
            <PathInput
              value={form.folderPath}
              onChange={form.setFolderPath}
              placeholder="Linked folder path"
              mode="folder"
            />
            {!features.linkedWorkspace && (
              <Text variant="muted" size="sm">
                Linking a live local folder stays in the desktop app.
              </Text>
            )}
          </>
        ) : (
          <ImportFilesSection
            importFolderInputRef={form.importFolderInputRef}
            importFilesInputRef={form.importFilesInputRef}
            onImportSelection={form.handleImportSelection}
            importSummary={form.importSummary}
            loading={form.loading}
          />
        )}

        <OrbitRepoSection
          isAuthenticated={form.isAuthenticated}
          orbitOwner={form.orbitOwner}
          orbitRepoMode={form.orbitRepoMode}
          setOrbitRepoMode={form.setOrbitRepoMode}
          orbitRepoName={form.orbitRepoName}
          setOrbitRepoName={form.setOrbitRepoName}
          proposedRepoSlug={form.proposedRepoSlug}
          displayRepoName={form.displayRepoName}
          orbitRepos={form.orbitRepos}
          orbitReposLoading={form.orbitReposLoading}
          selectedOrbitRepo={form.selectedOrbitRepo}
          setSelectedOrbitRepo={form.setSelectedOrbitRepo}
        />

        {form.error && (
          <Text variant="muted" size="sm" style={{ color: "var(--color-danger)" }}>
            {form.error}
          </Text>
        )}
        {!form.error && form.submitBlocker && (
          <Text variant="muted" size="sm" style={{ color: "var(--color-text-secondary)" }}>
            {form.submitBlocker}
          </Text>
        )}
      </div>
    </Modal>
  );
}
