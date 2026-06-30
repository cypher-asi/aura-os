import { memo } from "react";
import { Check } from "lucide-react";
import styles from "./InputBarShell.module.css";

export interface SecondOpinionRowProps {
  active: boolean;
  referenceLabel: string | null;
  onToggle: (active: boolean) => void;
}

export const SecondOpinionRow = memo(function SecondOpinionRow({
  active,
  referenceLabel,
  onToggle,
}: SecondOpinionRowProps) {
  return (
    <button
      type="button"
      className={`${styles.modelMenuItem} ${active ? styles.modelMenuItemActive : ""}`}
      data-agent-action="toggle-second-opinion"
      data-second-opinion-active={active ? "true" : "false"}
      aria-pressed={active}
      onClick={() => onToggle(!active)}
    >
      <span className={styles.councilCountLabel}>
        <span className={styles.modelMenuItemLabel}>Second Opinion</span>
        <span className={styles.councilCountHint}>
          {active && referenceLabel
            ? `${referenceLabel} advises final model`
            : "one reference, one final answer"}
        </span>
      </span>
      <span className={styles.modelMenuItemMeta}>
        {active ? <Check size={13} className={styles.modelMenuItemChevron} /> : null}
      </span>
    </button>
  );
});
