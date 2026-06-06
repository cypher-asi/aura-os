import type { CSSProperties, ReactNode } from "react";
import styles from "./HardwareKey.module.css";

interface HardwareKeyProps {
  readonly label: string;
  readonly icon?: ReactNode;
  /**
   * Lit / active state: warm accent fill + soft glow + an LED dot,
   * echoing the active keys on the reference hardware.
   */
  readonly lit?: boolean;
  /**
   * Accent color for the lit fill + LED glow. Any CSS color. Defaults to
   * the marketing orange used by the skill panel.
   */
  readonly accentColor?: string;
  /**
   * When false (the default for decorative marketing surfaces) the key
   * renders as a non-tabbable button: it keeps the real `<button>`
   * semantics for the a11y baseline but stays out of the tab order and
   * carries no hover-affordance contract.
   */
  readonly interactive?: boolean;
  readonly onClick?: () => void;
  readonly className?: string;
}

/**
 * Raised neomorphic key sunk into its own black socket: a near-black
 * recess (the socket) holding an extruded key with a top highlight,
 * bottom dark edge, and outer drop shadow. The shared primitive behind
 * the marketing skill panel and the agent console control banks. Always
 * a real `<button>` for the accessibility baseline; `interactive`
 * governs tab order + cursor.
 */
export function HardwareKey({
  label,
  icon,
  lit = false,
  accentColor,
  interactive = false,
  onClick,
  className,
}: HardwareKeyProps): ReactNode {
  const socketClassName = className
    ? `${styles.socket} ${className}`
    : styles.socket;
  const style = accentColor
    ? ({ "--hardware-key-accent": accentColor } as CSSProperties)
    : undefined;

  return (
    <div className={socketClassName} style={style}>
      <button
        type="button"
        tabIndex={interactive ? undefined : -1}
        className={styles.key}
        data-lit={lit ? "true" : undefined}
        data-interactive={interactive ? "true" : undefined}
        onClick={onClick}
      >
        {lit && <span className={styles.led} aria-hidden="true" />}
        {icon && <span className={styles.icon}>{icon}</span>}
        <span className={styles.label}>{label}</span>
      </button>
    </div>
  );
}
