import { Check, type LucideIcon } from "lucide-react";
import styles from "./SelectableCard.module.css";

interface SelectableCardProps {
  readonly title: string;
  readonly description?: string;
  readonly Icon?: LucideIcon;
  readonly selected: boolean;
  readonly disabled?: boolean;
  /** Trailing pill text, e.g. "Coming soon". */
  readonly badge?: string;
  readonly onSelect: () => void;
}

/**
 * Generic selectable tile used across the onboarding steps (skills,
 * integrations, connections, automations). Always a real `<button>` so it is
 * keyboard accessible; disabled tiles render as a non-interactive card.
 */
export function SelectableCard({
  title,
  description,
  Icon,
  selected,
  disabled = false,
  badge,
  onSelect,
}: SelectableCardProps): React.ReactElement {
  return (
    <button
      type="button"
      className={styles.card}
      data-selected={selected}
      disabled={disabled}
      aria-pressed={disabled ? undefined : selected}
      onClick={disabled ? undefined : onSelect}
    >
      {Icon ? (
        <span className={styles.icon} aria-hidden="true">
          <Icon size={20} />
        </span>
      ) : null}
      <span className={styles.body}>
        <span className={styles.title}>{title}</span>
        {description ? <span className={styles.description}>{description}</span> : null}
      </span>
      {badge ? <span className={styles.badge}>{badge}</span> : null}
      {selected && !disabled ? (
        <span className={styles.check} aria-hidden="true">
          <Check size={14} strokeWidth={3} />
        </span>
      ) : null}
    </button>
  );
}
