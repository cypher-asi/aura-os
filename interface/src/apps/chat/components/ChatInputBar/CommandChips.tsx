import { memo } from "react";
import { X } from "lucide-react";
import type { SlashCommand } from "../../../../constants/commands";
import styles from "./ChatInputBar.module.css";

interface Props {
  commands: SlashCommand[];
  onRemove: (id: string) => void;
  variant?: "stacked" | "inline";
}

export const CommandChips = memo(function CommandChips({
  commands,
  onRemove,
  variant = "stacked",
}: Props) {
  if (commands.length === 0) return null;
  const rootClassName = [
    styles.commandChips,
    variant === "inline" ? styles.commandChipsInline : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClassName} data-agent-surface={`command-chips-${variant}`}>
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
