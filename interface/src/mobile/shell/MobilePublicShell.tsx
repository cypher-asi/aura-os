import { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { Menu, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePublicChatStore } from "../../stores/public-chat-store";
import { MobilePublicMenu } from "./MobilePublicMenu";
import styles from "./MobilePublicShell.module.css";

/**
 * Mobile public shell.
 *
 * Mounted by `ResponsiveShell` (in `components/AppShell/AppShell.tsx`)
 * when the layout is mobile AND the effective UI mode is `public`.
 * Sibling of `MobileShell` (authed mobile) and `AuraShell` (desktop).
 *
 * Chrome:
 *   - Topbar (~52px) with the AURA wordmark on the left (linking
 *     home, same asset desktop's `PublicLeading` uses) and a
 *     hamburger button on the right.
 *   - Full-screen `MobilePublicMenu` overlay mirroring the desktop
 *     `PublicTopNav` areas (Agents / Code / Pricing flat, Resources
 *     expandable) plus the language selector and auth pills.
 *   - Body slot mounts the matched route via `<Outlet />` —
 *     `MobilePublicChatView` for `/` and `/chat`, or
 *     `PublicMarketingPanel` -> per-page view for the other public
 *     routes.
 *
 * Menu state is local — kept off the auth-coupled
 * `useMobileDrawerStore` so this shell stays independent of the
 * project / agent / sidekick machinery the authed mobile drawer
 * coordinates.
 */

const PUBLIC_CHAT_PATH = "/chat";

// Pixel thresholds for the scroll-direction topbar hide/show.
const TOPBAR_SHOW_NEAR_TOP_PX = 56;
const TOPBAR_SCROLL_DELTA_PX = 6;

/**
 * Hide the public topbar while scrolling down and re-reveal it while
 * scrolling up (and whenever the scroller is near the top).
 *
 * The public surface scrolls in different inner containers per route
 * (`.landingScroll`, the chat transcript, the marketing scroll column),
 * none of which is the document, so a single `window` listener can't see
 * them. Instead we listen in the capture phase on the shell root, which
 * observes scroll from whichever descendant container is active.
 */
function useHideTopbarOnScroll(resetKey: string): {
  shellRef: React.RefObject<HTMLDivElement | null>;
  hidden: boolean;
  instant: boolean;
} {
  const shellRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(false);
  // While true, the topbar reveal is applied without its transition so it
  // doesn't "unfold" on every navigation (the bar may have been hidden by
  // the previous page's scroll). Re-enabled on the next frame so live
  // scroll hide/show still animates.
  const [instant, setInstant] = useState(false);
  const lastYRef = useRef(0);
  const lastSourceRef = useRef<unknown>(null);

  // Always reveal the bar on navigation so a new page never opens with a
  // stale hidden state carried over from the previous page's scroll, and
  // snap it (no animation) so the route change reads as a clean cut rather
  // than the bar sliding back in.
  useEffect(() => {
    setHidden(false);
    setInstant(true);
    lastSourceRef.current = null;
    lastYRef.current = 0;
    const frame = window.requestAnimationFrame(() => setInstant(false));
    return () => window.cancelAnimationFrame(frame);
  }, [resetKey]);

  useEffect(() => {
    const shell = shellRef.current;
    if (shell == null) return undefined;

    // Apply the hide/show decision for a given scroll position + source.
    // `source` keys the baseline so switching scrollers (an inner
    // container vs. the document/window) can't produce a bogus delta.
    const applyPosition = (y: number, source: unknown): void => {
      if (source !== lastSourceRef.current) {
        lastSourceRef.current = source;
        lastYRef.current = y;
        if (y <= TOPBAR_SHOW_NEAR_TOP_PX) setHidden(false);
        return;
      }
      const delta = y - lastYRef.current;
      if (Math.abs(delta) < TOPBAR_SCROLL_DELTA_PX) return;
      lastYRef.current = y;
      if (y <= TOPBAR_SHOW_NEAR_TOP_PX || delta < 0) {
        setHidden(false);
      } else {
        setHidden(true);
      }
    };

    // Inner scrollers (landing / chat fixed-height surfaces) — captured so
    // scroll from any descendant container is observed.
    const onInnerScroll = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      applyPosition(target.scrollTop, target);
    };

    // Document scroller (marketing routes in document-scroll mode).
    const onWindowScroll = (): void => {
      applyPosition(window.scrollY, window);
    };

    const options: AddEventListenerOptions = { capture: true, passive: true };
    shell.addEventListener("scroll", onInnerScroll, options);
    window.addEventListener("scroll", onWindowScroll, { passive: true });
    return () => {
      shell.removeEventListener("scroll", onInnerScroll, options);
      window.removeEventListener("scroll", onWindowScroll);
    };
  }, []);

  return { shellRef, hidden, instant };
}

export function MobilePublicShell(): React.ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation(["publicChat"]);
  const [searchParams] = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const {
    shellRef,
    hidden: topbarHidden,
    instant: topbarInstant,
  } = useHideTopbarOnScroll(location.pathname);

  // The landing (`/`) and chat (`/chat`) surfaces are app-like: a pinned
  // WebGL hero background and a fixed bottom composer that depend on the
  // shell owning the viewport height, so they keep the inner-scroll model.
  // Every other public route is long marketing content, which scrolls as
  // one document so iOS Safari collapses its bottom address bar on
  // scroll-down (and the topbar reveal keys off `window` scroll).
  const isAppLikeRoute =
    location.pathname === "/" || location.pathname === PUBLIC_CHAT_PATH;
  const documentScroll = !isAppLikeRoute;

  useEffect(() => {
    if (!documentScroll) return undefined;
    const root = document.documentElement;
    root.classList.add("aura-public-doc-scroll");
    return () => root.classList.remove("aura-public-doc-scroll");
  }, [documentScroll]);

  const openMenu = useCallback(() => setMenuOpen(true), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Tapping the AURA wordmark scrolls the public surface back to the top.
  // When already on the landing route the `<Link to="/">` is a no-op
  // navigation, so we drive the scroll ourselves (and prevent the dead
  // click); from any other route we let it navigate home, which lands at
  // the top anyway. Scrolls both the document (marketing routes scroll the
  // window) and the landing's inner scroll container so it works in either
  // scroll mode.
  const handleLogoClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (location.pathname === "/") {
        event.preventDefault();
      }
      window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      document
        .querySelector<HTMLElement>("[data-public-home-scroll]")
        ?.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    },
    [location.pathname],
  );

  // Active public chat (for the topbar trash affordance). Read the
  // same selectors `MobilePublicChatView` uses so the button only
  // appears when there's a real session to delete. The visitor has
  // no session sidebar on mobile, so deleting the chat they're on
  // is the only delete entry point this surface ships.
  const sessions = usePublicChatStore((s) => s.sessions);
  const deleteSession = usePublicChatStore((s) => s.deleteSession);
  const activeSessionId = searchParams.get("session");
  const isChatPage = location.pathname === PUBLIC_CHAT_PATH;
  const activeSession =
    activeSessionId != null ? sessions[activeSessionId] ?? null : null;
  const canDeleteActiveChat =
    isChatPage && activeSessionId != null && activeSession != null;

  const handleDeleteActiveChat = useCallback(() => {
    if (activeSessionId == null) return;
    deleteSession(activeSessionId);
    // Mirror `PublicSessionsPanel.handleDelete`: hop to the most
    // recent remaining session if one exists, otherwise fall
    // through to bare `/chat`. `MobilePublicChatView` no longer
    // auto-mints on visit, so the visitor lands on an empty
    // composer rather than watching the deleted chat respawn.
    const remaining = usePublicChatStore.getState().sessionOrder;
    const nextActive = remaining.find((id) => id !== activeSessionId);
    navigate(
      nextActive != null ? `${PUBLIC_CHAT_PATH}?session=${nextActive}` : PUBLIC_CHAT_PATH,
      { replace: true },
    );
  }, [activeSessionId, deleteSession, navigate]);

  return (
    <div
      className={styles.shell}
      ref={shellRef}
      data-scroll-mode={documentScroll ? "document" : "fixed"}
      data-testid="mobile-public-shell"
    >
      <header
        className={styles.topbar}
        data-hidden={topbarHidden ? "true" : undefined}
        data-instant={topbarInstant ? "true" : undefined}
      >
        <Link
          to="/"
          className={styles.logoLink}
          onClick={handleLogoClick}
          aria-label={t("publicChat:mobileShell.homeAriaLabel", {
            defaultValue: "AURA home",
          })}
        >
          <img
            src="/AURA_logo_text_mark.png"
            alt="AURA"
            className={styles.logo}
            draggable={false}
            data-aura-wordmark
          />
        </Link>
        <div className={styles.topbarActions}>
          {canDeleteActiveChat ? (
            <button
              type="button"
              className={styles.deleteButton}
              onClick={handleDeleteActiveChat}
              aria-label={t("publicChat:sessions.deleteChatAriaLabel", {
                defaultValue: `Delete chat "${activeSession?.title ?? "this chat"}"`,
                title: activeSession?.title ?? "this chat",
              })}
              data-testid="mobile-public-delete-chat"
            >
              <Trash2 size={20} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className={styles.menuButton}
            aria-label={t("publicChat:mobileShell.openMenu", {
              defaultValue: "Open menu",
            })}
            aria-expanded={menuOpen}
            aria-controls="mobile-public-menu"
            onClick={openMenu}
            data-testid="mobile-public-menu-open"
          >
            <Menu size={22} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      </header>

      <main className={styles.body}>
        <Outlet />
      </main>

      <MobilePublicMenu open={menuOpen} onClose={closeMenu} />
    </div>
  );
}
