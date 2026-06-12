import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

interface TipPosition {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly placement: "above" | "below";
}

/** Vertical gap between the card and its description popover. */
const TIP_GAP = 8;
/** Rough popover height used to decide above/below placement. */
const TIP_ESTIMATED_HEIGHT = 96;

/**
 * Compact, tab-like selectable tile shared across the onboarding steps
 * (personality, skills, integrations, connections, automations). Shows an icon
 * + label only; the optional description is revealed on hover (web) or by
 * tapping the info dot (mobile) so tiles stay tight and scroll-free.
 *
 * The description popover renders in a body portal with fixed positioning so it
 * can never be clipped by the wizard's scrolling content or the stepper above.
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipPosition | null>(null);

  const openTip = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const placement: TipPosition["placement"] =
      rect.top >= TIP_ESTIMATED_HEIGHT + TIP_GAP ? "above" : "below";
    setTip({
      top: placement === "above" ? rect.top - TIP_GAP : rect.bottom + TIP_GAP,
      left: rect.left,
      width: rect.width,
      placement,
    });
  }, []);

  const closeTip = useCallback(() => setTip(null), []);

  const toggleTip = useCallback(() => {
    if (tip) closeTip();
    else openTip();
  }, [tip, openTip, closeTip]);

  // Close the popover on scroll/resize rather than tracking the moving anchor.
  useEffect(() => {
    if (!tip) return;
    window.addEventListener("scroll", closeTip, true);
    window.addEventListener("resize", closeTip);
    return () => {
      window.removeEventListener("scroll", closeTip, true);
      window.removeEventListener("resize", closeTip);
    };
  }, [tip, closeTip]);

  return (
    <div className={styles.wrap} ref={wrapRef}>
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
            aria-expanded={tip !== null}
            onClick={(e) => {
              e.stopPropagation();
              toggleTip();
            }}
            onMouseEnter={openTip}
            onMouseLeave={closeTip}
            onFocus={openTip}
            onBlur={closeTip}
          >
            <Info size={12} aria-hidden="true" />
          </button>
          {tip
            ? createPortal(
                <span
                  className={styles.tip}
                  role="tooltip"
                  data-placement={tip.placement}
                  style={{ top: tip.top, left: tip.left, width: tip.width }}
                >
                  {description}
                </span>,
                document.body,
              )
            : null}
        </>
      ) : null}
    </div>
  );
}
