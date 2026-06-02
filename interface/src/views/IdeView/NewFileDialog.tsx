import { useState, useRef, useEffect } from "react";
import styles from "./IdeView.module.css";

interface Props {
  onConfirm: (fileName: string) => Promise<string | null>;
  onCancel: () => void;
}

export function NewFileDialog({ onConfirm, onCancel }: Props) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    const err = await onConfirm(trimmed);
    if (err) {
      setError(err);
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <div className={styles.dialogOverlay} onClick={onCancel}>
      <div className={styles.dialogBox} onClick={(e) => e.stopPropagation()}>
        <label className={styles.dialogLabel}>New file name</label>
        <input
          ref={inputRef}
          className={styles.dialogInput}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="example.ts"
          disabled={submitting}
        />
        {error && <span className={styles.dialogError}>{error}</span>}
        <div className={styles.dialogActions}>
          <button className={styles.dialogButton} onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button className={styles.dialogButtonPrimary} onClick={handleSubmit} disabled={!value.trim() || submitting}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
