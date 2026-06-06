import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import styles from "./DotMatrixGrille.module.css";

interface DotMatrixGrilleProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Grille height as any CSS length. Defaults to 92px. */
  readonly height?: string;
  readonly className?: string;
}

/**
 * Dot-matrix speaker grille tiled from a single radial-gradient dot, so
 * it scales cleanly without a node per hole. Shared decorative primitive
 * for the marketing device mock-ups (service device, agent console).
 * Always `aria-hidden` — it carries no meaning.
 */
export function DotMatrixGrille({
  height,
  className,
  style,
  ...rest
}: DotMatrixGrilleProps): ReactNode {
  const grilleClassName = className
    ? `${styles.grille} ${className}`
    : styles.grille;
  const grilleStyle = height
    ? ({ ...style, "--grille-height": height } as CSSProperties)
    : style;

  return (
    <div
      className={grilleClassName}
      style={grilleStyle}
      aria-hidden="true"
      {...rest}
    />
  );
}
