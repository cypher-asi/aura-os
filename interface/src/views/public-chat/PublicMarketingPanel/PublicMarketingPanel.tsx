import { useEffect, useRef } from "react";
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
 * in sync with their CSS:
 *   /agents, /code -> `--marketing-section-bg` (`#090909`)
 *   /changelog, /feedback -> `--marketing-section-bg` (`#0f0f12`)
 *   /pricing -> `.pricingPage` (`#22272e`)
 *   /models  -> `.modelsPage` (`#16191d`)
 *   /download is transparent, so it keeps the `#000` default.
 *
 * `.scrollColumn` carries a `background-color` transition (see
 * `PublicMarketingPanel.module.css`) so these per-route colors
 * crossfade as the visitor navigates, in step with the shell-frame
 * gradient fade on `/agents` and `/code` (`AuraShell.module.css`).
 */
const MARKETING_PATH_BG: Readonly<Record<string, string>> = {
  "/agents": "#090909",
  "/code": "#090909",
  "/changelog": "#0f0f12",
  "/feedback": "#0f0f12",
  "/blog": "#0f0f12",
  "/pricing": "#22272e",
  "/models": "#16191d",
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
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);

  // Exact-match the per-route background, then fall back to a prefix
  // match so nested routes (e.g. `/blog/:slug`) inherit their section's
  // color instead of flashing the `#000` default while the chunk loads.
  const columnBackground =
    MARKETING_PATH_BG[pathname] ??
    (pathname.startsWith("/blog/") ? MARKETING_PATH_BG["/blog"] : undefined) ??
    DEFAULT_MARKETING_BG;

  return (
    <div className={styles.root}>
      <div
        ref={scrollRef}
        className={styles.scrollColumn}
        style={{ background: columnBackground }}
      >
        <Outlet key={pathname} />
      </div>
      <OverlayScrollbar scrollRef={scrollRef} />
    </div>
  );
}
