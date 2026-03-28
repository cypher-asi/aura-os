import { memo } from "react";
import { X } from "lucide-react";
import type { SlashCommand } from "../../constants/commands";
import styles from "../ChatView/ChatView.module.css";

interface Props {
  commands: SlashCommand[];
  onRemove: (id: string) => void;
}

export const CommandChips = memo(function CommandChips({
  commands,
  onRemove,
}: Props) {
  if (commands.length === 0) return null;
  return (
    <div className={styles.commandChips}>
      {commands.map((cmd) => (
        <span key={cmd.id} className={styles.commandChip}>
          <span className={styles.commandChipLabel}>/{cmd.label}</span>
          <button
            type="button"
            className={styles.commandChipRemove}
            onClick={() => onRemove(cmd.id)}
            aria-label={`Remove ${cmd.label}`}
          >
            <X size={10} />
          </button>
        </span>
      ))}
    </div>
  );
});
