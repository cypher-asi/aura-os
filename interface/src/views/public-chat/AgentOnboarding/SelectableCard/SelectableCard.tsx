import { useState } from "react";
import { Check, Info, type LucideIcon } from "lucide-react";
import styles from "./SelectableCard.module.css";

interface SelectableCardProps {
  readonly title: string;
  /** Secondary detail, revealed on hover (web) or tap of the info dot (mobile). */
  readonly description?: string;
  readonly Icon?: LucideIcon;
  readonly selected: boolean;
  readonly disabled?: boolean;
  /** Trailing pill text, e.g. "Coming soon". */
  readonly badge?: string;
  readonly onSelect: () => void;
}

/**
 * Compact, tab-like selectable tile shared across the onboarding steps
 * (personality, skills, integrations, connections, automations). Shows an icon
 * + label only; the optional description is revealed on hover (web) or by
 * tapping the info dot (mobile) so tiles stay tight and scroll-free.
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
  const [infoOpen, setInfoOpen] = useState(false);

  return (
    <div className={styles.wrap}>
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
            <Icon size={16} />
          </span>
        ) : null}
        <span className={styles.title}>{title}</span>
        {badge ? <span className={styles.badge}>{badge}</span> : null}
        {selected && !disabled ? (
          <span className={styles.check} aria-hidden="true">
            <Check size={11} strokeWidth={3} />
          </span>
        ) : null}
      </button>

      {description ? (
        <>
          <button
            type="button"
            className={styles.info}
            aria-label={`About ${title}`}
            aria-expanded={infoOpen}
            onClick={(e) => {
              e.stopPropagation();
              setInfoOpen((v) => !v);
            }}
            onBlur={() => setInfoOpen(false)}
          >
            <Info size={12} aria-hidden="true" />
          </button>
          <span className={styles.tip} role="tooltip" data-open={infoOpen}>
            {description}
          </span>
        </>
      ) : null}
    </div>
  );
}
