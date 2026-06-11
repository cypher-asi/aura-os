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
 * Routes grouped under `Resources`. `OS` moved here (from the primary
 * row) and sits at the bottom of the menu.
 */
export const RESOURCE_LINKS: ReadonlyArray<TopNavLink> = [
  { tKey: "blog", label: "Blog", to: "/blog" },
  { tKey: "changelog", label: "Changelog", to: "/changelog" },
  { tKey: "downloads", label: "Downloads", to: "/download" },
  { tKey: "feedback", label: "Feedback", to: "/feedback" },
  { tKey: "models", label: "Models", to: "/models" },
  { tKey: "os", label: "OS", to: "/os" },
];
