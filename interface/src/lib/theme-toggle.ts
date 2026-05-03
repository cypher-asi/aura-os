import type { ResolvedTheme, Theme } from "@cypher-asi/zui";

/**
 * Cycle order shared by the desktop titlebar toggle (Phase 2) and the mobile
 * topbar toggle (Phase 12): dark -> light -> system -> dark.
 */
const THEME_CYCLE: Record<Theme, Theme> = {
  dark: "light",
  light: "system",
  system: "dark",
};

export function cycleTheme(current: Theme): Theme {
  return THEME_CYCLE[current];
}

export type ThemeToggleIconKind = "sun" | "moon" | "system";

/**
 * Pick which icon to render. When the user has explicitly chosen "system"
 * we surface that with a dedicated icon; otherwise we mirror the active
 * resolved theme so users can see what's currently applied.
 */
export function getThemeToggleIconKind(
  theme: Theme,
  resolvedTheme: ResolvedTheme,
): ThemeToggleIconKind {
  if (theme === "system") return "system";
  return resolvedTheme === "light" ? "sun" : "moon";
}

/**
 * Human-readable aria-label for the toggle. Uses "system" (rather than the
 * resolved value) when the user has opted into system tracking, so screen
 * readers reflect the user's intent, not just the current state.
 */
export function getThemeToggleAriaLabel(
  theme: Theme,
  resolvedTheme: ResolvedTheme,
): string {
  const stateLabel = theme === "system" ? "system" : resolvedTheme;
  return `Switch theme (currently ${stateLabel})`;
}
