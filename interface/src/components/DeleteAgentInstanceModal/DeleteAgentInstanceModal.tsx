import { Modal, Button } from "@cypher-asi/zui";
import type { AgentInstance } from "../../types";
import styles from "../ProjectList/ProjectList.module.css";

interface DeleteAgentInstanceModalProps {
  target: AgentInstance | null;
  loading: boolean;
  error?: string | null;
  onClose: () => void;
  onDelete: () => void;
}

export function DeleteAgentInstanceModal({ target, loading, error, onClose, onDelete }: DeleteAgentInstanceModalProps) {
  return (
    <Modal
      isOpen={!!target}
      onClose={onClose}
      title="Remove Agent"
      size="sm"
      footer={
        <div className={styles.confirmFooter}>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={onDelete} disabled={loading} className={styles.dangerButton}>
            {loading ? "Removing..." : "Remove"}
          </Button>
        </div>
      }
    >
      <div className={styles.confirmMessage}>
        Are you sure you want to remove &ldquo;{target?.name}&rdquo; and all its messages? This action cannot be undone.
      </div>
      {error && (
        <div className={styles.errorMessage} role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}
