import { type ReactNode } from "react";
import "./PhoneShell.css";

interface PhoneShellProps {
  /**
   * Controls the rendered phone size and elevation.
   *   - `"md"` — side-phone treatment. Smaller, recessed (no
   *     translateY offset).
   *   - `"lg"` — centered hero phone. Larger, lifted forward,
   *     mirroring the middle device in the overlapping 3-phone
   *     silhouette this section is modeled after.
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
 * Reusable, pure-CSS marketing phone device. The chassis, embossed
 * black-glass screen, and neomorphic control deck are all painted with
 * CSS (no pre-rendered image), so the device scales crisply at any size
 * and stays self-contained. The mock interface supplied via `children`
 * is overlaid inside the screen well, clipped to its rounded corners.
 *
 * Layout, top to bottom:
 *   - `.phoneShellScreen` — recessed glossy black glass with an embossed
 *     bevel (darker top edge, brighter bottom lip) and a gradient border.
 *     Hosts `children` and casts a drop shadow onto the deck below.
 *   - `.phoneShellDeck` — a brushed-metal neomorphic panel carrying a
 *     rotary knob, a row of decorative keys, a CONTROL/AUTO toggle, a
 *     dot-matrix speaker grille, and the `AURA` wordmark.
 *
 * Everything below the screen is decorative hardware fiction
 * (`aria-hidden`). Sizing is `clamp()`-driven and respects the parent
 * flex container; the hero (`size="lg"`) variant is larger and lifted
 * forward so it visually overlaps the two side phones.
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
      <div className="phoneShellChassis">
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

        <div className="phoneShellDeck" aria-hidden="true">
          <div className="phoneShellKnob">
            <div className="phoneShellKnobDial">
              <span className="phoneShellKnobIndicator" />
            </div>
          </div>

          <div className="phoneShellControls">
            <div className="phoneShellButtons">
              <span className="phoneShellBtn" />
              <span className="phoneShellBtn" />
              <span className="phoneShellBtn" />
            </div>
            <div className="phoneShellToggle">
              <span className="phoneShellToggleKnob" />
            </div>
          </div>

          <div className="phoneShellGrille" />
          <span className="phoneShellWordmark">AURA</span>
        </div>
      </div>
    </div>
  );
}
