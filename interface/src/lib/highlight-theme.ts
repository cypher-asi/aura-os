// Vite resolves these `?url` imports to a hashed asset URL at build time
// (and to a dev-server URL during `vite dev`), so we can swap which CSS
// file is active by editing a single <link> tag instead of bundling both
// stylesheets and toggling them via attribute selectors. Keeps highlight.js
// CSS off the critical path for whichever theme isn't currently active.
import darkCssUrl from "highlight.js/styles/github-dark.min.css?url";
import lightCssUrl from "highlight.js/styles/github.min.css?url";

const HL_LINK_ID = "aura-highlight-theme";

export function applyHighlightTheme(resolved: "dark" | "light"): void {
  if (typeof document === "undefined") return;
  const href = resolved === "light" ? lightCssUrl : darkCssUrl;
  let link = document.getElementById(HL_LINK_ID) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.id = HL_LINK_ID;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  if (link.href !== href) link.href = href;
}
