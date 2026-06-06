import { type ReactNode } from "react";
import "./PhoneShell.css";

interface PhoneShellProps {
  /**
   * Controls the rendered phone size and elevation.
   *   - `"md"` — side-phone treatment. Smaller, recessed (no
   *     translateY offset).
   *   - `"lg"` — centered hero phone. Larger, lifted forward,
   *     mirroring the middle iPhone in the Apple iPhone 17 reference
   *     layout that this section is modeled after.
   */
  readonly size?: "md" | "lg";
  /**
   * Optional accessible label for the device frame. When omitted the
   * frame (and its render) is hidden from assistive tech; once a mock
   * interface is supplied via `children`, callers should pass a
   * descriptive label (e.g. "Mobile chat with the Coder agent") which
   * the inner mock UI inherits as its accessible name.
   */
  readonly ariaLabel?: string;
  /**
   * Content slot painted inside the phone screen. When omitted, the
   * shell renders the default skeleton placeholder so the empty frame
   * still telegraphs "this is where the mobile chat mock will live".
   */
  readonly children?: ReactNode;
}

/**
 * Presentational phone frame for the marketing page. The chassis is a
 * pre-rendered phone image (`/phone-shell.png`, cropped to the device
 * silhouette on a pure-black background that blends with the section
 * surface), and the mock interface supplied via `children` is overlaid
 * on top, clipped to the render's screen rectangle.
 *
 * Sizing is `clamp()`-driven and respects the parent flex container,
 * so the same component scales from desktop hero widths down to the
 * single phone shown on narrow mobile viewports without per-breakpoint
 * overrides on the consumer. The hero (`size="lg"`) variant is larger
 * and lifted forward so it visually overlaps the two side phones.
 */
export function PhoneShell({
  size = "md",
  ariaLabel,
  children,
}: PhoneShellProps): ReactNode {
  const isHero = size === "lg";
  const className = isHero ? "phoneShell phoneShellHero" : "phoneShell";

  return (
    <div
      className={className}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <img className="phoneShellImage" src="/phone-shell.png" alt="" aria-hidden />
      <div className="phoneShellScreen">
        {children ?? (
          <div className="phoneShellPlaceholder">
            <span className="phoneShellPlaceholderBar" />
            <span className="phoneShellPlaceholderBar" />
            <span className="phoneShellPlaceholderBar" />
            <span className="phoneShellPlaceholderLabel">Mock UI</span>
          </div>
        )}
      </div>
    </div>
  );
}
