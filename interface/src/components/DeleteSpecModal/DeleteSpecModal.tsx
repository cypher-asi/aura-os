import { Modal, Button } from "@cypher-asi/zui";
import type { Spec } from "../../shared/types";
import styles from "../ProjectList/ProjectList.module.css";

interface DeleteSpecModalProps {
  target: Spec | null;
  loading: boolean;
  error?: string | null;
  onClose: () => void;
  onDelete: () => void;
}

export function DeleteSpecModal({ target, loading, error, onClose, onDelete }: DeleteSpecModalProps) {
  return (
    <Modal
      isOpen={!!target}
      onClose={onClose}
      title="Delete Spec"
      size="sm"
      footer={
        <div className={styles.confirmFooter}>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={onDelete} disabled={loading} className={styles.dangerButton}>
            {loading ? "Deleting..." : "Delete"}
          </Button>
        </div>
      }
    >
      <div className={styles.confirmMessage}>
        Are you sure you want to delete &ldquo;{target?.title || "this spec"}&rdquo;? This action cannot be undone.
      </div>
      {error && (
        <div className={styles.errorMessage} role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}
