import { Pencil, Trash2 } from "lucide-react";
import styles from "./SidekickActions.module.css";

interface SidekickActionsProps {
  onEdit?: () => void;
  onDelete?: () => void;
}

export function SidekickActions({ onEdit, onDelete }: SidekickActionsProps) {
  return (
    <div className={styles.actions}>
      {onEdit && (
        <button className={styles.actionBtn} onClick={onEdit} title="Edit">
          <Pencil size={14} />
          <span>Edit</span>
        </button>
      )}
      {onDelete && (
        <button className={styles.actionBtn} onClick={onDelete} title="Delete">
          <Trash2 size={14} />
          <span>Delete</span>
        </button>
      )}
    </div>
  );
}
