import type { CSSProperties, ReactNode } from "react";
import styles from "./Knob.module.css";

type KnobVariant = "light" | "accent" | "dark";

interface KnobProps {
  readonly label?: string;
  /** Dial fill style. Defaults to "dark". */
  readonly variant?: KnobVariant;
  /** Pointer rotation in degrees (0 = pointing up). Defaults to 0. */
  readonly angle?: number;
  /** Dial diameter as any CSS length. Defaults to 58px. */
  readonly size?: string;
  /** Render the surrounding tick-mark scale ring. Defaults to true. */
  readonly ticks?: boolean;
  readonly className?: string;
}

const VARIANT_CLASS: Record<KnobVariant, string> = {
  light: styles.dialLight,
  accent: styles.dialAccent,
  dark: styles.dialDark,
};

/**
 * Hardware control knob: a recessed tick scale, a raised dial with a
 * top highlight, and a pointer indicator, with an optional caption
 * above. Shared decorative primitive for the marketing device kit
 * (`aria-hidden`); the dial fill follows the `variant` and the pointer
 * rotates by `angle`.
 */
export function Knob({
  label,
  variant = "dark",
  angle = 0,
  size,
  ticks = true,
  className,
}: KnobProps): ReactNode {
  const knobClassName = className ? `${styles.knob} ${className}` : styles.knob;
  const style = size
    ? ({ "--knob-size": size } as CSSProperties)
    : undefined;
  const pointerStyle = { transform: `rotate(${angle}deg)` };

  return (
    <div className={knobClassName} style={style} aria-hidden="true">
      {label && <span className={styles.label}>{label}</span>}
      <div className={styles.dialWrap}>
        {ticks && <span className={styles.ticks} />}
        <span className={`${styles.dial} ${VARIANT_CLASS[variant]}`}>
          <span className={styles.pointer} style={pointerStyle} />
        </span>
      </div>
    </div>
  );
}
