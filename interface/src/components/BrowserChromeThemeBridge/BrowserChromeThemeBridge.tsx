import { useEffect } from "react";
import { useTheme } from "@cypher-asi/zui";

const THEME_COLORS = {
  dark: "#05070d",
  light: "#ffffff",
} as const;

const MANIFEST_HREFS = {
  dark: "/manifest.webmanifest",
  light: "/manifest-light.webmanifest",
} as const;

/**
 * Renders nothing; subscribes to ZUI's `useTheme().resolvedTheme` and
 * keeps the `<meta name="theme-color">` content and the PWA manifest
 * `<link rel="manifest">` href in sync with the in-app theme.
 *
 * Without this bridge those tags are static (the inline boot script in
 * `index.html` sets them once on the very first frame) and the browser
 * chrome — Chrome's tab thumbnail/strip color, mobile URL bar, the
 * installed-PWA window chrome — would stop tracking AURA's light/dark
 * choice as soon as the user toggled themes at runtime.
 *
 * Mounted once in `main.tsx`, sibling to `<HighlightThemeBridge />` and
 * `<ThemeOverridesBridge />` inside `<ThemeProvider>`.
 */
export function BrowserChromeThemeBridge(): null {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const meta = document.getElementById("aura-theme-color");
    if (meta) {
      meta.setAttribute("content", THEME_COLORS[resolvedTheme]);
    }
    const manifest = document.getElementById("aura-manifest");
    if (manifest) {
      manifest.setAttribute("href", MANIFEST_HREFS[resolvedTheme]);
    }
  }, [resolvedTheme]);

  return null;
}
