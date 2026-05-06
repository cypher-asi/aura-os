import { Button, Modal, Text } from "@cypher-asi/zui";
import { Loader2 } from "lucide-react";
import styles from "./DeleteAgentConfirmModal.module.css";
import type { AgentProjectBinding } from "./use-cascade-delete-agent";

/**
 * Shared confirmation modal for [`useCascadeDeleteAgent`]. Lives in
 * its own file so any surface that wants the cascade-delete UX (the
 * sidebar context menu, the agent detail panel, the marketplace
 * panel, etc.) can import it without dragging in transitive
 * dependencies of the larger surfaces.
 *
 * Callers must defer opening this modal until cascade bindings have
 * loaded (typically via [`useDeferredModalOpen`](../../../shared/hooks/use-deferred-modal-open.ts)
 * with `prepare: () => cascade.refresh()`). With that contract the
 * footer label and body content are stable from first paint, so the
 * modal opens once at its final size with no jank.
 */
export function DeleteAgentConfirmModal({
  isOpen,
  onClose,
  onDelete,
  deleting,
  deleteError,
  bindings,
  agentName,
}: {
  isOpen: boolean;
  onClose: () => void;
  onDelete: () => void;
  deleting: boolean;
  deleteError: string | null;
  bindings: AgentProjectBinding[];
  agentName: string;
}) {
  const bindingCount = bindings.length;
  const projectList = bindings
    .map((b) => b.project_name.trim() || "Untitled project")
    .join(", ");
  const buttonLabel = deleting
    ? "Deleting..."
    : bindingCount > 0
      ? `Delete (${bindingCount} project${bindingCount === 1 ? "" : "s"})`
      : "Delete";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Delete Agent"
      size="sm"
      footer={
        <div className={styles.footer}>
          <Button variant="ghost" onClick={onClose} disabled={deleting}>Cancel</Button>
          <Button variant="danger" onClick={onDelete} disabled={deleting}>
            {deleting ? (
              <><Loader2 size={14} className={styles.spin} /> Deleting...</>
            ) : (
              buttonLabel
            )}
          </Button>
        </div>
      }
    >
      <Text size="sm">
        Are you sure you want to delete <strong>{agentName}</strong>? This cannot be undone.
      </Text>
      {bindingCount > 0 && (
        <Text size="xs" variant="muted" className={styles.cascadeNote}>
          This agent is currently added to: <strong>{projectList}</strong>. Deleting will remove it from {bindingCount === 1 ? "this project" : "these projects"} first.
        </Text>
      )}
      {deleteError && (
        <Text size="xs" className={styles.error}>{deleteError}</Text>
      )}
    </Modal>
  );
}
