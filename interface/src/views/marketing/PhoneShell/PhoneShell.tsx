import { type ReactNode } from "react";
import "./PhoneShell.css";

/**
 * Decorative slang keycaps on the phone's metal deck, styled after the
 * "Intelligent in all domains" skill keys. Purely decorative hardware
 * (`aria-hidden` via the deck root); a couple rest in the golden accent.
 */
const DECK_KEYS: ReadonlyArray<{
  readonly id: string;
  readonly label: string;
  readonly lit?: boolean;
}> = [
  { id: "cook", label: "COOK", lit: true },
  { id: "send-it", label: "SEND IT" },
  { id: "no-cap", label: "NO CAP" },
  { id: "yolo", label: "YOLO", lit: true },
  { id: "for-the-plot", label: "FOR THE PLOT" },
];

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
 *     behind/under the top panel, carrying a centered row of raised
 *     keycaps styled after the "Intelligent in all domains" skill keys.
 *
 * Everything in the deck is decorative hardware fiction (`aria-hidden`).
 * Sizing is `clamp()`-driven and respects the parent flex container;
 * the hero (`size="lg"`) variant is larger and lifted forward so it
 * visually overlaps the two side phones.
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
        <div className="phoneShellKeys">
          {DECK_KEYS.map(({ id, label, lit }) => (
            <span
              key={id}
              className="phoneShellKey"
              data-lit={lit ? "true" : undefined}
            >
              <span className="phoneShellKeyLabel">{label}</span>
            </span>
          ))}
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
