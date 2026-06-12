import type { CSSProperties, ReactNode } from "react";
import type { ProjectAppearance } from "../../shared/api/appearance";
import { ProjectRowIcon } from "./ProjectRowIcon";

/**
 * Fields driven by a project's appearance that every project-list
 * builder (projects sidebar, tasks, process, …) wants to set the
 * same way on its explorer node. Returned in a shape that spreads
 * cleanly onto an `ExplorerNodeWithSuffix`.
 */
export interface ProjectRowAppearanceFields {
  /** `<ProjectRowIcon projectId={...} />`. Always a component
   *  (subscribes to its own appearance entry), so the row updates
   *  when the user changes the icon / accent without the parent
   *  builder having to re-run. */
  icon: ReactNode;
  /** Inline style for the row label `<span>`. Tints the project
   *  name to `appearance.nameColor` when set; undefined when unset
   *  so the label inherits the sidebar's default text color. */
  labelStyle?: CSSProperties;
  /** Inline style for the row container. Carries accent stripe
   *  (via `--accent-stripe-color` CSS custom property), background
   *  fill, and outline. Returns `undefined` when none of the three
   *  is configured so unthemed projects render exactly as before. */
  headerStyle?: CSSProperties;
}

/**
 * Derive the appearance-driven fields for a project row from its
 * `appearance.json`. Pure function — call it inside any builder's
 * `useMemo` block alongside the app-specific fields (suffix,
 * children).
 *
 * Priority rules baked in here so every project-list surface stays
 * consistent:
 *
 *  - `headerOutline` and `headerBackground` each suppress the accent
 *    stripe; whichever of those is set "owns" the row's visual
 *    treatment and stacking a stripe on top would just add noise.
 *  - When no chip styling is configured at all, `headerStyle` is
 *    `undefined` (rather than an empty object) so React's diff
 *    doesn't tag every render as a style change.
 *
 * The stripe is painted by `.projectHeader::before` in
 * `LeftMenuTree.module.css`; we just expose its color here via a
 * `--accent-stripe-color` CSS custom property. Pseudo-element
 * painting bypasses the row's 6px border-radius clip so the stripe
 * stays straight top-to-bottom (inset by the radius amount).
 */
export function buildProjectRowAppearance(
  projectId: string,
  appearance: ProjectAppearance | undefined,
): ProjectRowAppearanceFields {
  const hasOutline = !!appearance?.headerOutline;
  const hasBackground = !!appearance?.headerBackground;
  const showAccentStripe =
    !!appearance?.accent && !hasOutline && !hasBackground;
  const hasChipStyling =
    showAccentStripe || hasBackground || hasOutline;

  const headerStyle: CSSProperties | undefined = hasChipStyling
    ? ({
        background: appearance!.headerBackground,
        border: hasOutline
          ? `1px solid ${appearance!.headerOutline}`
          : undefined,
        ...(showAccentStripe
          ? buildAccentStripeStyle(
              appearance!.accent!,
              appearance!.accentPosition,
            )
          : {}),
      } as CSSProperties)
    : undefined;

  const labelStyle: CSSProperties | undefined = appearance?.nameColor
    ? { color: appearance.nameColor }
    : undefined;

  return {
    icon: <ProjectRowIcon projectId={projectId} />,
    labelStyle,
    headerStyle,
  };
}

/**
 * Inline-style CSS custom properties that drive the accent stripe's
 * color and geometry. The painting is done by the `.projectHeader::before`
 * and `.preview::before` rules; this helper just sets the variables the
 * CSS reads. `"bottom"` flips the stripe to a horizontal bar inset from
 * the rounded corners; anything else (or undefined) leaves the CSS
 * defaults in place — a vertical bar on the left edge.
 */
export function buildAccentStripeStyle(
  accent: string,
  position: "left" | "bottom" | undefined,
): CSSProperties {
  if (position === "bottom") {
    return {
      ["--accent-stripe-color" as string]: accent,
      ["--accent-stripe-top" as string]: "auto",
      ["--accent-stripe-bottom" as string]: "0",
      ["--accent-stripe-left" as string]: "6px",
      ["--accent-stripe-right" as string]: "6px",
      ["--accent-stripe-width" as string]: "auto",
      ["--accent-stripe-height" as string]: "1px",
    } as CSSProperties;
  }
  return { ["--accent-stripe-color" as string]: accent } as CSSProperties;
}
