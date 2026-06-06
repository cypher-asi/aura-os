import type { HTMLAttributes, ReactNode } from "react";
import styles from "./DeviceScreen.module.css";

interface DeviceScreenProps extends HTMLAttributes<HTMLDivElement> {
  readonly children?: ReactNode;
  /**
   * Render the top gloss reflection across the glass. Defaults to true;
   * set false for a matte recessed well (e.g. an LED status readout).
   */
  readonly gloss?: boolean;
  readonly className?: string;
}

/**
 * Recessed glossy black screen surface from the marketing "device"
 * language: a deep inset-shadow well that reads as glass sunk below a
 * bezel, with an optional top gloss reflection. Used as the shared
 * primitive for any on-device screen (the agent console CRT, the
 * service-device logo grid). The component owns only the recessed
 * surface; consumers supply their own screen content + padding via
 * `children` / `className`.
 */
export function DeviceScreen({
  children,
  gloss = true,
  className,
  ...rest
}: DeviceScreenProps): ReactNode {
  const screenClassName = className
    ? `${styles.screen} ${className}`
    : styles.screen;

  return (
    <div className={screenClassName} {...rest}>
      {gloss && <div className={styles.gloss} aria-hidden="true" />}
      {children}
    </div>
  );
}
