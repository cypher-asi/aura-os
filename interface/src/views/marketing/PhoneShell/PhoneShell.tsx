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
 * Reusable, pure-CSS marketing phone device built from two SEPARATE
 * stacked panels (no single chassis wrapping them):
 *   - `.phoneShellTop` — the dark-glass screen panel with a thin metallic
 *     bevel rim. Hosts `children` (the mock UI) and rests ON TOP of the
 *     deck, slightly overlapping it and casting a drop shadow onto it.
 *   - `.phoneShellDeck` — the wider brushed-metal control panel sitting
 *     behind/under the top panel, carrying a recessed analog VU-meter /
 *     compressor LCD (gold-glowing arc scale, swaying needle, and
 *     INPUT/OUTPUT readouts) in the page's gold accent family.
 *
 * Everything in the deck is decorative hardware fiction (`aria-hidden`).
 * Sizing is `cqw`-driven (container context on `.phoneShell`) so the LCD
 * gauge, ticks, needle, and labels all scale in lockstep with the device
 * width; the hero (`size="lg"`) variant is larger and lifted forward so
 * it visually overlaps the two side phones.
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
      <div className="phoneShellDeck" aria-hidden="true">
        <div className="phoneShellLcd">
          <svg
            className="phoneShellLcdGauge"
            viewBox="0 0 200 96"
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Arced dB scale (sweeps from lower-left up to lower-right). */}
            <path
              className="phoneShellLcdArc"
              d="M 24 88 A 80 80 0 0 1 176 88"
              fill="none"
            />
            {/* Tick marks + numbered labels along the arc. Angles span the
                same -60deg..+60deg sweep the needle pivots through, with the
                pivot at the bottom-center (100, 92). */}
            {[
              { label: "-30", angle: -58 },
              { label: "-20", angle: -34 },
              { label: "-10", angle: -8 },
              { label: "-5", angle: 14 },
              { label: "0", angle: 40 },
            ].map(({ label, angle }) => {
              const rad = ((angle - 90) * Math.PI) / 180;
              const cx = 100;
              const cy = 92;
              const rOuter = 76;
              const rInner = 66;
              const rText = 54;
              return (
                <g key={label} className="phoneShellLcdTickGroup">
                  <line
                    className="phoneShellLcdTick"
                    x1={cx + rInner * Math.cos(rad)}
                    y1={cy + rInner * Math.sin(rad)}
                    x2={cx + rOuter * Math.cos(rad)}
                    y2={cy + rOuter * Math.sin(rad)}
                  />
                  <text
                    className="phoneShellLcdTickLabel"
                    x={cx + rText * Math.cos(rad)}
                    y={cy + rText * Math.sin(rad)}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {label}
                  </text>
                </g>
              );
            })}
            {/* Needle: pivots from the bottom-center, animated via CSS. */}
            <line
              className="phoneShellLcdNeedle"
              x1="100"
              y1="92"
              x2="100"
              y2="20"
            />
            <circle className="phoneShellLcdHub" cx="100" cy="92" r="5" />
          </svg>

          <span className="phoneShellLcdTitle">COMPRESSOR</span>
          <span className="phoneShellLcdSub">TUBE</span>

          <div className="phoneShellLcdReadout phoneShellLcdReadout--in">
            <span className="phoneShellLcdReadoutLabel">INPUT</span>
            <span className="phoneShellLcdReadoutValue">-1.03 dB</span>
          </div>
          <div className="phoneShellLcdReadout phoneShellLcdReadout--out">
            <span className="phoneShellLcdReadoutLabel">OUTPUT</span>
            <span className="phoneShellLcdReadoutValue">+0.00 dB</span>
          </div>

          <div className="phoneShellLcdGloss" />
        </div>
      </div>

      <div className="phoneShellTop">
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
    </div>
  );
}
