/**
 * Single source of truth for the public marketing nav areas.
 *
 * Consumed by BOTH public nav surfaces so they can never drift:
 *   - `PublicTopNav` (desktop titlebar nav: flat primary links +
 *     the `Resources` dropdown)
 *   - `MobilePublicMenu` (full-screen mobile menu: flat primary rows
 *     + the expandable `Resources` group)
 *
 * Lives in its own module (not `PublicTopNav.tsx`) so component files
 * keep exporting only components (react-refresh/only-export-components).
 */

export interface TopNavLink {
  /** i18n key in the `nav` namespace. */
  tKey: string;
  /** English fallback label. */
  label: string;
  to: string;
}

/**
 * Primary marketing links, rendered left-to-right in the desktop top
 * bar and as flat rows in the mobile menu. `Expertise` and `Resources`
 * are not in this list — they open dropdowns / expandable groups
 * instead of navigating to a single route. `Pricing` sits beside
 * `Code`; `OS` moved into the `Resources` group.
 */
export const PRIMARY_LINKS: ReadonlyArray<TopNavLink> = [
  { tKey: "agents", label: "Agents", to: "/agents" },
  { tKey: "code", label: "Code", to: "/code" },
  { tKey: "pricing", label: "Pricing", to: "/pricing" },
];

/**
 * Routes grouped under `Resources`. The desktop dropdown renders these
 * as two side-by-side columns (see `PublicTopNav`): `Changelog` heads
 * the left column and `Blog` heads the right. The mobile menu renders
 * the combined `RESOURCE_LINKS` list (below) as a single flat group.
 */
export const RESOURCE_LINKS_PRIMARY: ReadonlyArray<TopNavLink> = [
  { tKey: "changelog", label: "Changelog", to: "/changelog" },
  { tKey: "docs", label: "Docs", to: "/docs" },
  { tKey: "feedback", label: "Feedback", to: "/feedback" },
  { tKey: "downloads", label: "Downloads", to: "/download" },
];

export const RESOURCE_LINKS_SECONDARY: ReadonlyArray<TopNavLink> = [
  { tKey: "blog", label: "Blog", to: "/blog" },
  { tKey: "models", label: "Models", to: "/models" },
  { tKey: "os", label: "OS", to: "/os" },
];

/**
 * Flat union of both columns, left column first. Single source of truth
 * for the mobile `Resources` group and for the active-route detection
 * shared by both nav surfaces.
 */
export const RESOURCE_LINKS: ReadonlyArray<TopNavLink> = [
  ...RESOURCE_LINKS_PRIMARY,
  ...RESOURCE_LINKS_SECONDARY,
];
