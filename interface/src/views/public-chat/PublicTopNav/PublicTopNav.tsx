import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import styles from "./PublicTopNav.module.css";

interface TopNavLink {
  /** i18n key in the `nav` namespace. */
  tKey: string;
  /** English fallback label. */
  label: string;
  to: string;
}

/**
 * Primary marketing links, rendered left-to-right in the centered
 * top bar. `Resources` is not in this list — it opens the dropdown
 * below instead of navigating to a single route.
 */
const PRIMARY_LINKS: ReadonlyArray<TopNavLink> = [
  { tKey: "agents", label: "Agents", to: "/agents" },
  { tKey: "code", label: "Code", to: "/code" },
  { tKey: "os", label: "OS", to: "/os" },
  { tKey: "pricing", label: "Pricing", to: "/pricing" },
];

/** Routes grouped under the `Resources` dropdown. */
const RESOURCE_LINKS: ReadonlyArray<TopNavLink> = [
  { tKey: "blog", label: "Blog", to: "/blog" },
  { tKey: "changelog", label: "Changelog", to: "/changelog" },
  { tKey: "feedback", label: "Feedback", to: "/feedback" },
  { tKey: "models", label: "Models", to: "/models" },
];

/**
 * Public-mode marketing navigation, mounted in the centered title
 * slot of `AuraTitlebar` (replacing the old left-sidebar
 * `PublicSidebarFooter`). The top-left AURA logo handles "home", so
 * there is no Home link here; "Chat" lives in the bottom-left
 * taskbar. The links swap the public-mode main panel content while
 * leaving the rest of the public shell (titlebar + sidebar + this
 * nav) mounted.
 *
 * Public-only: rendered exclusively from `AuraTitlebar`'s public
 * branch so logged-in users never see the marketing nav.
 */
export function PublicTopNav(): React.ReactElement {
  const { pathname } = useLocation();
  const { t } = useTranslation("nav");
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  const resourcesActive = RESOURCE_LINKS.some(
    (link) => pathname === link.to || pathname.startsWith(`${link.to}/`),
  );

  const clearCloseTimer = useCallback((): void => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const openMenu = useCallback((): void => {
    clearCloseTimer();
    setMenuOpen(true);
  }, [clearCloseTimer]);

  const closeMenu = useCallback((): void => {
    clearCloseTimer();
    setMenuOpen(false);
  }, [clearCloseTimer]);

  // Hover-out closes after a short grace period so the pointer can
  // cross the small gap between the trigger and the portal menu without
  // the dropdown collapsing mid-travel. Re-entering either element
  // (`openMenu` / `clearCloseTimer`) cancels the pending close.
  const scheduleClose = useCallback((): void => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setMenuOpen(false);
    }, 140);
  }, [clearCloseTimer]);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  // Outside-click + Escape close the dropdown.
  useEffect(() => {
    if (!menuOpen) return;
    const handlePointer = (event: MouseEvent): void => {
      if (
        triggerRef.current?.contains(event.target as Node) ||
        menuRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      setMenuOpen(false);
    };
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      window.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  // Anchor the portal menu under the trigger. Measured synchronously
  // so the menu paints in the right spot on the same frame it opens.
  useLayoutEffect(() => {
    if (!menuOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 6, left: rect.left });
  }, [menuOpen]);

  const linkClassName = useCallback(
    ({ isActive }: { isActive: boolean }) =>
      `${styles.link} ${isActive ? styles.linkActive : ""}`,
    [],
  );

  return (
    <nav
      className={`${styles.nav} titlebar-no-drag`}
      aria-label="AURA public navigation"
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {PRIMARY_LINKS.map((link) => (
        <NavLink key={link.tKey} to={link.to} className={linkClassName}>
          {t(link.tKey, { defaultValue: link.label })}
        </NavLink>
      ))}
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.link} ${styles.resourcesTrigger} ${
          resourcesActive || menuOpen ? styles.linkActive : ""
        }`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        // Hover (mouseenter) already opens the menu; an explicit
        // click/tap should keep it open rather than toggle it shut
        // (touch devices that don't hover still get an open path).
        // The menu closes on hover-out, Escape, outside-click, or
        // selecting an item.
        onClick={openMenu}
        onMouseEnter={openMenu}
        onMouseLeave={scheduleClose}
        onFocus={openMenu}
      >
        {t("resources", { defaultValue: "Resources" })}
        <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
      </button>
      {menuOpen &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Resources"
            className={styles.menu}
            style={{ top: menuPos.top, left: menuPos.left }}
            onMouseEnter={clearCloseTimer}
            onMouseLeave={scheduleClose}
          >
            {RESOURCE_LINKS.map((link) => (
              <NavLink
                key={link.tKey}
                to={link.to}
                role="menuitem"
                onClick={closeMenu}
                className={({ isActive }) =>
                  `${styles.menuItem} ${isActive ? styles.menuItemActive : ""}`
                }
              >
                {t(link.tKey, { defaultValue: link.label })}
              </NavLink>
            ))}
          </div>,
          document.body,
        )}
    </nav>
  );
}
