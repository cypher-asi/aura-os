import { useCallback, useState } from "react";
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

export function MobilePublicShell(): React.ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation(["publicChat"]);
  const [searchParams] = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);

  const openMenu = useCallback(() => setMenuOpen(true), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

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
    <div className={styles.shell} data-testid="mobile-public-shell">
      <header className={styles.topbar}>
        <Link
          to="/"
          className={styles.logoLink}
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
            <Menu size={22} aria-hidden="true" />
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
