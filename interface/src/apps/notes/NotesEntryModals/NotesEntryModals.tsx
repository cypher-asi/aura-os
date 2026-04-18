import { Modal, Button } from "@cypher-asi/zui";
import { InlineRenameInput } from "../../../components/InlineRenameInput";
import { folderIdFor, noteIdFor } from "../NotesNav/notes-explorer-ids";
import type { NotesContextMenuApi } from "../NotesNav/useNotesContextMenu";
import styles from "./NotesEntryModals.module.css";

export interface NotesEntryModalsProps {
  actions: NotesContextMenuApi;
}

export function NotesEntryModals({ actions }: NotesEntryModalsProps) {
  const renameTarget = actions.renameTarget;
  const deleteTarget = actions.deleteTarget;

  return (
    <>
      {renameTarget && (
        <InlineRenameInput
          target={{
            id:
              renameTarget.kind === "note"
                ? noteIdFor(renameTarget.projectId, renameTarget.relPath)
                : folderIdFor(renameTarget.projectId, renameTarget.relPath),
            name: renameTarget.name,
          }}
          onSave={(name) => void actions.handleRenameSave(name)}
          onCancel={() => actions.setRenameTarget(null)}
        />
      )}

      <Modal
        isOpen={!!deleteTarget}
        onClose={() => {
          actions.setDeleteTarget(null);
          actions.setDeleteError(null);
        }}
        title={deleteTarget?.kind === "folder" ? "Delete Folder" : "Delete Note"}
        size="sm"
        footer={
          <div className={styles.confirmFooter}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                actions.setDeleteTarget(null);
                actions.setDeleteError(null);
              }}
              disabled={actions.deleteLoading}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void actions.handleDelete()}
              disabled={actions.deleteLoading}
              className={styles.dangerButton}
            >
              {actions.deleteLoading ? "Deleting..." : "Delete"}
            </Button>
          </div>
        }
      >
        <div className={styles.confirmMessage}>
          Are you sure you want to delete &ldquo;{deleteTarget?.name}&rdquo;?
          {deleteTarget?.kind === "folder"
            ? " All notes inside the folder will be deleted."
            : ""}{" "}
          This action cannot be undone.
        </div>
        {actions.deleteError && (
          <div className={styles.errorMessage} role="alert">
            {actions.deleteError}
          </div>
        )}
      </Modal>
    </>
  );
}
