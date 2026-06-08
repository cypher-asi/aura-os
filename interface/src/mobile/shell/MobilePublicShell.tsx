import { useCallback, useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { Globe, Menu, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { track } from "../../lib/analytics";
import { usePublicChatStore } from "../../stores/public-chat-store";
import { useLanguageStore } from "../../stores/language-store";
import { LANGUAGES } from "../../i18n/languages";
import styles from "./MobilePublicShell.module.css";

/**
 * Mobile public shell.
 *
 * Mounted by `ResponsiveShell` (in `components/AppShell/AppShell.tsx`)
 * when the layout is mobile AND the effective UI mode is `public`.
 * Sibling of `MobileShell` (authed mobile) and `AuraShell` (desktop).
 *
 * Chrome:
 *   - Topbar (~52px) with a hamburger button on the left and the
 *     AURA wordmark in the center.
 *   - Slide-in drawer from the left listing the public marketing
 *     destinations and the auth pills (Log In / Sign Up).
 *   - Body slot mounts the matched route via `<Outlet />` —
 *     `MobilePublicChatView` for `/` and `/chat`, or
 *     `PublicMarketingPanel` -> per-page view for the other public
 *     routes.
 *
 * Drawer state is local — kept off the auth-coupled
 * `useMobileDrawerStore` so this shell stays independent of the
 * project / agent / sidekick machinery the authed mobile drawer
 * coordinates.
 */

interface NavRow {
  /** i18n key in the `nav` namespace. */
  readonly tKey: string;
  /** English fallback label. */
  readonly label: string;
  readonly to: string;
  readonly end?: boolean;
}

const NAV_ROWS: ReadonlyArray<NavRow> = [
  { tKey: "chat", label: "Chat", to: "/chat" },
  { tKey: "agents", label: "Agents", to: "/agents" },
  { tKey: "code", label: "Code", to: "/code" },
  { tKey: "os", label: "OS", to: "/os" },
  { tKey: "pricing", label: "Pricing", to: "/pricing" },
  { tKey: "blog", label: "Blog", to: "/blog" },
  { tKey: "changelog", label: "Changelog", to: "/changelog" },
  { tKey: "feedback", label: "Feedback", to: "/feedback" },
  { tKey: "models", label: "Models", to: "/models" },
];

const PUBLIC_CHAT_PATH = "/chat";

export function MobilePublicShell(): React.ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation(["nav", "auth", "common"]);
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  const [searchParams] = useSearchParams();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

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

  // Drawer closes only via explicit user action — backdrop click, X
  // button, Escape, or clicking one of the nav rows / auth pills
  // (each `<Link>` and `<NavLink>` in the drawer wires `onClick` to
  // `closeDrawer`). We deliberately do NOT close on `location`
  // changes via `useEffect`: setState inside an effect against a
  // routing dependency triggers the `react-hooks/set-state-in-effect`
  // guard, and the explicit click-to-close path covers every
  // intentional navigation from this surface.

  // Body-scroll lock + Escape-to-dismiss while the drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
    };
  }, [drawerOpen]);

  // Login overlay state piggybacks on the desktop pattern: navigate
  // to `/login?tab=...` with `state.backgroundLocation` so the
  // overlay paints over whichever public route the visitor was on.
  // Mirrors `PublicActions` in `components/AuraShell/AuraTitlebar.tsx`.
  const signinSearch = location.search || "";
  const signupParams = new URLSearchParams(location.search);
  signupParams.set("tab", "register");
  const signupSearch = `?${signupParams.toString()}`;
  const backgroundState = { backgroundLocation: location };

  return (
    <div className={styles.shell} data-testid="mobile-public-shell">
      <header className={styles.topbar}>
        <button
          type="button"
          className={styles.menuButton}
          aria-label={drawerOpen ? "Close menu" : "Open menu"}
          aria-expanded={drawerOpen}
          aria-controls="mobile-public-drawer"
          onClick={drawerOpen ? closeDrawer : openDrawer}
        >
          {drawerOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        </button>
        <Link to="/" className={styles.wordmark} aria-label="AURA home">
          AURA
        </Link>
        {canDeleteActiveChat ? (
          <button
            type="button"
            className={styles.deleteButton}
            onClick={handleDeleteActiveChat}
            aria-label={`Delete chat "${activeSession?.title ?? "this chat"}"`}
            data-testid="mobile-public-delete-chat"
          >
            <Trash2 size={20} aria-hidden="true" />
          </button>
        ) : (
          <span className={styles.topbarSpacer} aria-hidden="true" />
        )}
      </header>

      <main className={styles.body}>
        <Outlet />
      </main>

      {/*
        Drawer rendered after the body so its z-index stack lands
        above the chat surface. Backdrop button is keyboard-focusable
        when open and `aria-hidden`/`tabIndex={-1}` when closed so the
        focus order skips it.
      */}
      <button
        type="button"
        className={`${styles.backdrop} ${drawerOpen ? styles.backdropOpen : ""}`}
        aria-label="Close menu"
        aria-hidden={!drawerOpen}
        tabIndex={drawerOpen ? 0 : -1}
        onClick={closeDrawer}
      />
      <aside
        id="mobile-public-drawer"
        className={`${styles.drawer} ${drawerOpen ? styles.drawerOpen : ""}`}
        aria-hidden={!drawerOpen}
        aria-label="Public navigation"
      >
        <div className={styles.drawerHeader}>
          <span className={styles.drawerTitle}>AURA</span>
          <button
            type="button"
            className={styles.drawerClose}
            aria-label="Close menu"
            onClick={closeDrawer}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <nav className={styles.drawerNav} aria-label="Public sections">
          {NAV_ROWS.map((row) => (
            <NavLink
              key={row.tKey}
              to={row.to}
              end={row.end}
              onClick={closeDrawer}
              className={({ isActive }) =>
                `${styles.drawerLink} ${isActive ? styles.drawerLinkActive : ""}`
              }
            >
              {t(`nav:${row.tKey}`, { defaultValue: row.label })}
            </NavLink>
          ))}
        </nav>
        <div className={styles.drawerDivider} aria-hidden="true" />
        <label className={styles.languageRow}>
          <span className={styles.languageLabel}>
            <Globe size={16} aria-hidden="true" />
            {t("common:language", { defaultValue: "Language" })}
          </span>
          <select
            className={styles.languageSelect}
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            aria-label={t("common:language", { defaultValue: "Language" })}
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.nativeName}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.drawerDivider} aria-hidden="true" />
        <div className={styles.drawerAuth}>
          <Link
            to={{ pathname: "/login", search: signinSearch }}
            state={backgroundState}
            className={`${styles.authPill} ${styles.authPillSecondary}`}
            onClick={() => {
              closeDrawer();
              track("public_login_clicked", { source: "mobile_drawer" });
            }}
          >
            {t("auth:logIn", { defaultValue: "Log In" })}
          </Link>
          <Link
            to={{ pathname: "/login", search: signupSearch }}
            state={backgroundState}
            className={`${styles.authPill} ${styles.authPillPrimary}`}
            onClick={() => {
              closeDrawer();
              track("public_signup_clicked", { source: "mobile_drawer" });
            }}
          >
            {t("auth:signUp", { defaultValue: "Sign Up" })}
          </Link>
        </div>
      </aside>
    </div>
  );
}
