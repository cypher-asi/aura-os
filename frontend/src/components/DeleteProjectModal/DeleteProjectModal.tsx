import { Modal, Button } from "@cypher-asi/zui";
import type { Project } from "../../types";
import styles from "../ProjectList/ProjectList.module.css";

interface DeleteProjectModalProps {
  target: Project | null;
  loading: boolean;
  onClose: () => void;
  onDelete: () => void;
}

export function DeleteProjectModal({ target, loading, onClose, onDelete }: DeleteProjectModalProps) {
  return (
    <Modal
      isOpen={!!target}
      onClose={onClose}
      title="Delete Project"
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
        Are you sure you want to delete &ldquo;{target?.name}&rdquo;? This action cannot be undone.
      </div>
    </Modal>
  );
}
