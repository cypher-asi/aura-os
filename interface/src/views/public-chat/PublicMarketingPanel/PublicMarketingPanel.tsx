import { useEffect, useLayoutEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import { usePublicPageViewed } from "../use-public-shell-analytics";
import styles from "./PublicMarketingPanel.module.css";

/*
 * Dark-mode `--color-text-primary` / `--color-text-secondary` hex
 * pair (sourced from `vendor/zui/src/styles/themes.css` and
 * `interface/src/styles/tokens.css`). Published on `<html>` for the
 * lifetime of this layout route so the persistent
 * `PublicSidebarFooter` nav (mounted in `AuraSidebar`, a sibling of
 * the marketing `<main>` panel) stays readable on the panel's
 * theme-invariant `#000` background — without this, a light-mode
 * visitor on `/product` would see the nav fall back to
 * `--color-text-secondary` (`#374151`) and the labels disappear
 * into the black panel.
 *
 * The sibling `PublicChatView` publishes the same vars per active
 * persona on `/`, so the two layouts hand the values off cleanly:
 * navigating from `/` -> `/product` swaps PublicChatView's persona
 * pair for this fixed dark pair, and navigating back swaps it
 * straight back. `PublicSidebarFooter` itself never unmounts, so it
 * always reads whichever pair is currently published.
 */
const MARKETING_NAV_FG_COLOR = "#e6e8eb";
const MARKETING_NAV_FG_COLOR_MUTED = "#c9c9cf";

/*
 * Per-route background for the scroll column, keyed off the
 * destination pathname. The marketing views are lazy-loaded under
 * `<Suspense fallback={null}>` (see `App.tsx`), so on the FIRST visit
 * to a page — before its chunk is cached — the fallback renders
 * nothing and the only visible surface is this column. Painting the
 * column the destination page's own background color (instead of the
 * `#000` CSS default) means the lazy gap blends into the page that is
 * about to paint, killing the black blink. `pathname` updates
 * synchronously on navigation, so the correct color is already in
 * place while the chunk loads.
 *
 * These values mirror each view's first painted surface and must stay
 * in sync with their CSS. The primary marketing pages now share a flat
 * `#090909` surface (matching `/agents` + `/code`), so they all preload
 * the same color:
 *   /agents, /code, /pricing, /blog, /changelog, /feedback, /models,
 *   /os, /download, /docs, /terms, /privacy -> flat `#090909`
 *
 * `.scrollColumn` carries a `background-color` transition (see
 * `PublicMarketingPanel.module.css`) so these per-route colors
 * crossfade as the visitor navigates, in step with the shell-frame
 * gradient fade (`AuraShell.module.css`).
 */
const MARKETING_PATH_BG: Readonly<Record<string, string>> = {
  "/agents": "#090909",
  "/code": "#090909",
  "/changelog": "#090909",
  "/feedback": "#090909",
  "/blog": "#090909",
  "/os": "#090909",
  "/docs": "#090909",
  "/terms": "#090909",
  "/privacy": "#090909",
  "/pricing": "#090909",
  "/models": "#090909",
  "/download": "#090909",
};

const DEFAULT_MARKETING_BG = "#000";

/**
 * Layout route that mounts inside `AuraShell`'s `<main>` outlet for
 * the four public marketing pages (`/product`, `/changelog`,
 * `/feedback`, `/pricing`). It wraps the per-page `<Outlet />` in a
 * scrollable column because `AuraShell.mainPanel` is locked to
 * `overflow: hidden` and the marketing views (e.g. `ChangelogView`,
 * `PricingView`) emit long vertical sections that expect their
 * container to scroll.
 *
 * Replaces the old standalone `MarketingShell` (its own dark-themed
 * `MarketingNavbar` + `MarketingFooter` wrapper) so the marketing
 * pages render under the same public-mode chrome — `ShellTitlebar`,
 * `AuraSidebar`, and `PublicSidebarFooter` — as the public chat
 * surface. The persona tick rail and "Create your agent"
 * CTA disappear automatically because they live inside
 * `PublicChatView`, which only mounts on the chat / landing routes.
 *
 * The page-level scroll uses the shared `OverlayScrollbar` (same
 * sleek mouseover-revealed 4px pill used by the aura-os left menu
 * and every other long scroll surface in the shell) instead of the
 * browser's default scrollbar. `.scrollColumn` hides the native
 * scrollbar and `<OverlayScrollbar>` mounts as a sibling inside the
 * positioned `.root` wrapper so the overlay track anchors to the
 * panel rectangle and never scrolls with the marketing content.
 *
 * While mounted, this panel also pins `--public-nav-fg-color` and
 * `--public-nav-fg-color-muted` on `<html>` to the dark-mode hex
 * pair so the persistent `PublicSidebarFooter` nav (a sibling
 * outside this panel's subtree) stays readable on the
 * `#000` panel background regardless of the user's resolved theme.
 * `PublicChatView` publishes the same vars per persona on `/`, so
 * the two layouts hand the values off without a flash on route
 * change. See `MARKETING_NAV_FG_COLOR` constant below.
 */
export function PublicMarketingPanel(): React.ReactElement {
  usePublicPageViewed();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--public-nav-fg-color", MARKETING_NAV_FG_COLOR);
    root.style.setProperty(
      "--public-nav-fg-color-muted",
      MARKETING_NAV_FG_COLOR_MUTED,
    );
    return () => {
      root.style.removeProperty("--public-nav-fg-color");
      root.style.removeProperty("--public-nav-fg-color-muted");
    };
  }, []);

  // Reset the scroll column to the top whenever the visitor
  // navigates between marketing pages. `PublicMarketingPanel` is a
  // layout route that does NOT unmount when the `<Outlet />`
  // content swaps (e.g. `/product` -> `/changelog`), so without
  // this effect the previous page's scroll position would persist
  // into the next page. The login overlay's background-location
  // pattern stashes the marketing path in `routeLocation`, so
  // `useLocation()` inside this panel still reads the marketing
  // pathname when the modal is open and we won't fight the overlay.
  //
  // This runs in `useLayoutEffect` (not `useEffect`) so the reset
  // happens after the DOM mutation but BEFORE the browser paints.
  // When the destination view's lazy chunk is already cached, React
  // renders it synchronously into this same `.scrollColumn` node,
  // which keeps the previous `scrollTop`. A post-paint `useEffect`
  // would let the new page paint already scrolled down and then snap
  // to the top (visible jank), and the scroll-driven reveal /
  // autoplay observers would evaluate against the stale position.
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);

  // Exact-match the per-route background, then fall back to a prefix
  // match so nested routes (e.g. `/blog/:slug`) inherit their section's
  // color instead of flashing the `#000` default while the chunk loads.
  const columnBackground =
    MARKETING_PATH_BG[pathname] ??
    (pathname.startsWith("/blog/") ? MARKETING_PATH_BG["/blog"] : undefined) ??
    (pathname.startsWith("/os/") ? MARKETING_PATH_BG["/os"] : undefined) ??
    (pathname.startsWith("/docs/") ? MARKETING_PATH_BG["/docs"] : undefined) ??
    DEFAULT_MARKETING_BG;

  // Keep the `/os` whitepaper view mounted across `/os/:slug` navigation so its
  // left-nav (collapse state + scroll position) survives section clicks instead
  // of remounting. The OS view reads the slug param reactively, so only the
  // reading column needs to swap. Every other route keeps the per-pathname
  // remount (and the scroll-column reset above still runs on every pathname).
  const outletKey =
    pathname === "/os" || pathname.startsWith("/os/") ? "os" : pathname;

  return (
    <div className={styles.root}>
      <div
        ref={scrollRef}
        className={styles.scrollColumn}
        style={{ background: columnBackground }}
        // Stable hook so the header nav (see `PublicTopNav`) can reset
        // this column to the top when the visitor clicks the link for
        // the page they are already on — same-route clicks are a no-op
        // for React Router, so it never resets on its own.
        data-marketing-scroll-column=""
      >
        <Outlet key={outletKey} />
      </div>
      <OverlayScrollbar scrollRef={scrollRef} />
    </div>
  );
}
