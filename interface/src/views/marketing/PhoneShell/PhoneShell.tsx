import { type ReactNode } from "react";
import "./PhoneShell.css";

interface PhoneShellProps {
  /**
   * Controls the rendered phone size and elevation.
   *   - `"md"` — side-phone treatment. Smaller, recessed (no
   *     translateY offset, lighter shadow).
   *   - `"lg"` — centered hero phone. Larger, lifted forward with
   *     a deeper shadow, mirroring the middle iPhone in the
   *     Apple iPhone 17 reference layout that this section is
   *     modeled after.
   */
  readonly size?: "md" | "lg";
  /**
   * Optional accessible label for the device frame. Defaults to
   * a generic "Phone preview" since the placeholder shell carries
   * no real content yet — once the mock chat UIs land, callers
   * should pass a descriptive label (e.g. "Plan-mode chat with the
   * Coder agent").
   */
  readonly ariaLabel?: string;
  /**
   * Optional content slot that paints inside the phone screen. When
   * omitted, the shell renders the default skeleton placeholder
   * (three faint rounded bars + a "Mock UI" hint label) so the
   * empty frame still telegraphs "this is where the mobile chat
   * mock will live".
   */
  readonly children?: ReactNode;
}

/**
 * Pure presentational phone frame for the marketing page. Mounted
 * by `AgentChatSection` today and intended to back any future
 * phone-heavy themed section. Owns the beveled metal chassis +
 * protruding button/tick + inset screen geometry only — the mock
 * interface inside is supplied by the
 * caller via `children`, or left as a faint skeleton placeholder
 * if no children are passed.
 *
 * Sizing is `clamp()`-driven and respects the parent flex
 * container, so the same component scales from desktop hero
 * widths down to the single phone shown on narrow mobile
 * viewports without per-breakpoint overrides on the consumer.
 *
 * The phone is `aria-hidden` by default because v1 ships an empty
 * placeholder. Once real mock interfaces land, callers should
 * pass `ariaLabel` to expose the frame to assistive tech and the
 * inner mock UI will inherit the label as its accessible name.
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
      <div className="phoneShellFrame">
        <span className="phoneShellButton" aria-hidden />
        <span className="phoneShellTick" aria-hidden />
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
