import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import styles from "./Plate.module.css";

interface PlateProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /**
   * Corner radius applied to all three rings. Accepts any CSS length
   * (e.g. `"22px"` for a panel, `"999px"` for a pill). Defaults to 22px.
   */
  radius?: string;
  className?: string;
}

/**
 * Reusable hardware "plate": the three-ring bordered surface used across
 * the marketing sections. Layered outside-in:
 *
 *   outer gradient ring (dark TL -> light BR)
 *     -> black ring
 *       -> inner gradient ring (light TL -> dark BR) + radial surface
 *
 * Each gradient ring is a real 1px transparent border filled via the
 * `border-box` gradient technique, and the black ring is a solid fill
 * revealed through 2px of padding. Real borders are anti-aliased crisply
 * by the browser on rounded corners, which a masked-ring approach is not.
 *
 * The plate owns only the rim + surface; consumers supply their own
 * content padding inside `children`. The shared corner radius is driven
 * by the `--plate-radius` custom property so a single rule set serves
 * both the pill-shaped chat capsule and the rounded device panel.
 */
export function Plate({
  children,
  radius,
  className,
  style,
  ...rest
}: PlateProps): ReactNode {
  const plateStyle = radius
    ? ({ ...style, "--plate-radius": radius } as CSSProperties)
    : style;

  return (
    <div
      className={`${styles.plate} ${className ?? ""}`}
      style={plateStyle}
      {...rest}
    >
      <div className={styles.black}>
        <div className={styles.inner}>{children}</div>
      </div>
    </div>
  );
}
