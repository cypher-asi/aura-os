import { useThemeOverrides } from "../../hooks/use-theme-overrides";

/**
 * Renders nothing; runs `useThemeOverrides()` for its side effects so the
 * persisted per-resolved-theme token overrides are reapplied as inline
 * `document.documentElement.style` rules whenever the active resolved
 * theme flips. Mounted once inside `<ThemeProvider>` in `main.tsx`,
 * sibling to `<HighlightThemeBridge />`.
 */
export function ThemeOverridesBridge(): null {
  useThemeOverrides();
  return null;
}
