import { useEffect } from "react";
import { useTheme } from "@cypher-asi/zui";
import { applyHighlightTheme } from "../../lib/highlight-theme";

/**
 * Renders nothing; subscribes to ZUI's `useTheme().resolvedTheme` and
 * swaps the active highlight.js stylesheet to match. Mounted once near
 * the root, inside `<ThemeProvider>` so the hook resolves correctly.
 *
 * The initial stylesheet is also injected synchronously from `main.tsx`
 * (read directly off `<html data-theme>`), so the first paint is correct
 * even before this effect runs — this component only handles subsequent
 * theme changes.
 */
export function HighlightThemeBridge(): null {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    applyHighlightTheme(resolvedTheme);
  }, [resolvedTheme]);

  return null;
}
