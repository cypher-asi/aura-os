import type { ReactNode } from "react";
import styles from "./DeviceLabelStrip.module.css";

interface DeviceLabelStripProps {
  readonly label: string;
  /**
   * Number of leading asterisk markers. Defaults to 3. One marker (the
   * `accentIndex`th) is painted in the accent color.
   */
  readonly markCount?: number;
  /** Zero-based index of the accented marker. Defaults to 1. */
  readonly accentIndex?: number;
  readonly className?: string;
}

const ASTERISK = "\u2731";

/**
 * Hardware label strip: a hairline-topped row of asterisk markers on the
 * left and a right-aligned monospace caption, selling the "device" panel
 * fiction. Shared decorative primitive (`aria-hidden`) used under the
 * marketing device screens.
 */
export function DeviceLabelStrip({
  label,
  markCount = 3,
  accentIndex = 1,
  className,
}: DeviceLabelStripProps): ReactNode {
  const stripClassName = className
    ? `${styles.strip} ${className}`
    : styles.strip;

  return (
    <div className={stripClassName} aria-hidden="true">
      <div className={styles.marks}>
        {Array.from({ length: markCount }, (_, index) => (
          <span
            key={index}
            className={
              index === accentIndex
                ? `${styles.asterisk} ${styles.asteriskAccent}`
                : styles.asterisk
            }
          >
            {ASTERISK}
          </span>
        ))}
      </div>
      <span className={styles.label}>{label}</span>
      <span className={styles.asterisk}>{ASTERISK}</span>
    </div>
  );
}
