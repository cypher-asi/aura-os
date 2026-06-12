import { type ReactNode, createElement } from "react";
import "./BannerCard.css";

type BannerCardElement = "section" | "div" | "article";

interface BannerCardProps {
  readonly children: ReactNode;
  /**
   * Semantic element rendered for the outer card. Defaults to
   * `section` so the most common marketing use (a labelled summary
   * panel — see `ChangelogView`'s "Changelog summary" card) gets the
   * right landmark role for free. Switch to `div` for purely
   * presentational chrome, or `article` for self-contained content
   * (e.g. a feature spotlight inside a list).
   */
  readonly as?: BannerCardElement;
  /**
   * Extra class appended to the base `bannerCard` class. Use to
   * attach layout-context concerns (e.g. `margin-bottom` on a page)
   * that aren't part of the shared chrome.
   */
  readonly className?: string;
  readonly ariaLabel?: string;
  readonly ariaLabelledBy?: string;
}

/**
 * Reusable outer chrome for marketing "banner" surfaces — a single
 * "risen black glass" card lifted off the flat `#090909`
 * (`--marketing-section-bg`) page surface.
 *
 * Owns three things and nothing else:
 *   1. Surface — a near-black translucent fill (`rgba(18,18,21,0.55)`)
 *      under a top-down white wash, so the card reads one notch lighter
 *      than the page without introducing a new shade.
 *   2. Elevation — an inset top-bevel highlight (the "risen" lit edge)
 *      plus soft drop + contact shadows so the slab floats above the
 *      page.
 *   3. Spacing — 28px/32px padding (22px on narrow viewports) and a
 *      28px (22px on narrow) flex-column gap between direct
 *      children, so consumers can drop a `<header>` + `<body>` pair
 *      in without re-declaring the rhythm.
 *
 * Intentionally has SQUARE corners and NO border — the marketing
 * surface treats banner cards as full-width slabs rather than
 * pill-shaped tiles, which is what the `/changelog` summary card
 * was redesigned around.
 *
 * Internal layout (grids, halos, etc.) lives on the children — see
 * `.changelogStatsCardBody` in `ChangelogView.css` for the prior
 * art the chrome here was lifted from.
 */
export function BannerCard({
  children,
  as = "section",
  className,
  ariaLabel,
  ariaLabelledBy,
}: BannerCardProps): ReactNode {
  const composedClassName = className
    ? `bannerCard ${className}`
    : "bannerCard";

  return createElement(
    as,
    {
      className: composedClassName,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
    },
    children,
  );
}
