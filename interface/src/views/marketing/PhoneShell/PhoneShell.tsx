import {
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import "./PhoneShell.css";

/** How often the INPUT/OUTPUT readouts tick to their next value. */
const READOUT_TICK_MS = 160;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Formats a dB value as a signed, 2-decimal readout (e.g. `+0.42 dB`). */
function formatDb(value: number): string {
  const sign = value > 0.005 ? "+" : value < -0.005 ? "" : "";
  return `${sign}${value.toFixed(2)} dB`;
}

/**
 * Per-instance randomized motion for the VU-meter needle so the three phones
 * sway at different speeds and across different positions. Computed once per
 * mount and fed to the needle as CSS custom properties + animation timing; a
 * negative delay desyncs the starting position so they never march in step.
 */
function makeNeedleStyle(): CSSProperties {
  // 0deg points straight up (center); positive = right of center, toward the
  // 0 dB / high-vibes side. The needle dwells at `maxAngle` (right of center)
  // and only dips back toward `minAngle` (around/left of center) briefly.
  const minAngle = -(8 + Math.random() * 18); // dip end: ~ -8deg..-26deg
  const maxAngle = 24 + Math.random() * 14; // dwell end: ~ +24deg..+38deg
  const duration = 3 + Math.random() * 3; // 3s..6s
  const delay = -Math.random() * duration; // desync start position
  return {
    "--needle-min": `${minAngle.toFixed(1)}deg`,
    "--needle-max": `${maxAngle.toFixed(1)}deg`,
    animationDuration: `${duration.toFixed(2)}s`,
    animationDelay: `${delay.toFixed(2)}s`,
  } as CSSProperties;
}

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

  const [needleStyle] = useState(makeNeedleStyle);

  // Live-meter INPUT/OUTPUT readouts: a bounded random walk so the numbers
  // gradually count up and down like a real level meter.
  const [readout, setReadout] = useState({ input: -1.03, output: 0 });
  useEffect(() => {
    let input = -1.03;
    let output = 0;
    const id = window.setInterval(() => {
      input = clamp(input + (Math.random() - 0.5) * 0.7, -6, -0.1);
      output = clamp(output + (Math.random() - 0.5) * 0.6, -3, 1.5);
      setReadout({ input, output });
    }, READOUT_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

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
            <defs>
              {/* Arc stroke gradient: opaque across the middle, fading to
                  nothing at the left and right ends. */}
              <linearGradient
                id="phoneShellArcFade"
                x1="0"
                y1="0"
                x2="1"
                y2="0"
              >
                <stop offset="0%" stopColor="#d7d7d7" stopOpacity="0" />
                <stop offset="26%" stopColor="#d7d7d7" stopOpacity="0.5" />
                <stop offset="74%" stopColor="#d7d7d7" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#d7d7d7" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Arced dB scale; ends fade into nothing via the stroke gradient. */}
            <path
              className="phoneShellLcdArc"
              d="M 30.7 58 A 80 80 0 0 1 169.3 58"
              fill="none"
              stroke="url(#phoneShellArcFade)"
            />

            {/* Tick marks straddling the arc, with numbered labels sitting
                ABOVE the ticks (outside the semicircle). The needle pivot is at
                the bottom-center (100, 98), just below the visible viewport. */}
            {[
              { label: "-30", angle: -55 },
              { label: "-20", angle: -34 },
              { label: "-10", angle: -10 },
              { label: "-5", angle: 16 },
              { label: "0", angle: 42 },
            ].map(({ label, angle }) => {
              const rad = (angle * Math.PI) / 180;
              const cx = 100;
              const cy = 98;
              const rInner = 72;
              const rOuter = 84;
              const rText = 92;
              const sin = Math.sin(rad);
              const cos = Math.cos(rad);
              return (
                <g key={label}>
                  <line
                    className="phoneShellLcdTick"
                    x1={cx + rInner * sin}
                    y1={cy - rInner * cos}
                    x2={cx + rOuter * sin}
                    y2={cy - rOuter * cos}
                  />
                  <text
                    className="phoneShellLcdTickLabel"
                    x={cx + rText * sin}
                    y={cy - rText * cos}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {label}
                  </text>
                </g>
              );
            })}

          </svg>

          {/* Needle: a full-height element pivoting from the bottom-center of
              the whole LCD so it runs all the way to the bottom of the screen
              and sweeps up toward the scale. */}
          <div className="phoneShellLcdNeedle" style={needleStyle} />

          <span className="phoneShellLcdTitle">DREAMS</span>
          <span className="phoneShellLcdSub">TUBE</span>

          <div className="phoneShellLcdReadout phoneShellLcdReadout--in">
            <span className="phoneShellLcdReadoutLabel">INPUT</span>
            <span className="phoneShellLcdReadoutValue">
              {formatDb(readout.input)}
            </span>
          </div>
          <div className="phoneShellLcdReadout phoneShellLcdReadout--out">
            <span className="phoneShellLcdReadoutLabel">OUTPUT</span>
            <span className="phoneShellLcdReadoutValue">
              {formatDb(readout.output)}
            </span>
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
