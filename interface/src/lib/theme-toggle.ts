import type { ResolvedTheme, Theme } from "@cypher-asi/zui";

/**
 * Two-state toggle: light <-> dark. The titlebar / mobile topbar buttons
 * flip between the two explicit themes — `system` is intentionally not
 * part of the cycle (per product decision to keep the toggle a binary
 * switch). If the user previously opted into `system` (e.g. via stored
 * preference) the next click resolves to the OPPOSITE of whatever
 * `prefers-color-scheme` is currently rendering, so the click always
 * produces a visible change.
 */
export function cycleTheme(current: Theme, resolvedTheme: ResolvedTheme): Theme {
  if (current === "system") {
    return resolvedTheme === "dark" ? "light" : "dark";
  }
  return current === "dark" ? "light" : "dark";
}

export type ThemeToggleIconKind = "sun" | "moon";

/**
 * Pick which icon to render. We mirror the currently-applied theme so
 * users can see what's active at a glance — sun = light, moon = dark.
 * `system` resolves to whichever of light/dark the OS is currently
 * showing, so the icon stays meaningful even if the stored preference
 * is `system`.
 */
export function getThemeToggleIconKind(
  _theme: Theme,
  resolvedTheme: ResolvedTheme,
): ThemeToggleIconKind {
  return resolvedTheme === "light" ? "sun" : "moon";
}

/**
 * Human-readable aria-label for the toggle. Reports the resolved theme
 * (what's actually painted) so screen-reader users get the same signal
 * as sighted users reading the icon.
 */
export function getThemeToggleAriaLabel(
  _theme: Theme,
  resolvedTheme: ResolvedTheme,
): string {
  return `Switch theme (currently ${resolvedTheme})`;
}
