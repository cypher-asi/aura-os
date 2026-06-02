import { useState, useRef, useEffect } from "react";
import styles from "./IdeView.module.css";

interface Props {
  name: string;
  isDir: boolean;
  onConfirm: () => Promise<string | null>;
  onCancel: () => void;
}

export function ConfirmDeleteDialog({ name, isDir, onConfirm, onCancel }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const err = await onConfirm();
      if (err) {
        setError(err);
        setSubmitting(false);
      }
    } catch (e) {
      setError(String(e));
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <div className={styles.dialogOverlay} onClick={onCancel}>
      <div ref={boxRef} className={styles.dialogBox} tabIndex={-1} onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <label className={styles.dialogLabel}>Are you sure?</label>
        <p className={styles.dialogText}>
          Delete {isDir ? "folder" : "file"} <strong>{name}</strong>?{" "}
          {isDir && "All contents will be permanently removed."}
        </p>
        {error && <span className={styles.dialogError}>{error}</span>}
        <div className={styles.dialogActions}>
          <button className={styles.dialogButton} onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button className={styles.dialogButtonDanger} onClick={handleConfirm} disabled={submitting}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
