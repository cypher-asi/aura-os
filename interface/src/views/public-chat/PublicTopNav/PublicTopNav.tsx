import {
  type ReactNode,
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
import {
  CAPABILITIES,
  INDUSTRIES,
  type ExpertiseEntry,
} from "../../marketing/ExpertiseDetailView/expertiseData";
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
 * top bar. `Expertise` and `Resources` are not in this list — they
 * open dropdowns instead of navigating to a single route.
 */
const PRIMARY_LINKS: ReadonlyArray<TopNavLink> = [
  { tKey: "agents", label: "Agents", to: "/agents" },
  { tKey: "code", label: "Code", to: "/code" },
  { tKey: "os", label: "OS", to: "/os" },
];

/**
 * Routes grouped under the `Resources` dropdown. `Pricing` moved here
 * (from the primary row) and sits at the top.
 */
const RESOURCE_LINKS: ReadonlyArray<TopNavLink> = [
  { tKey: "pricing", label: "Pricing", to: "/pricing" },
  { tKey: "blog", label: "Blog", to: "/blog" },
  { tKey: "changelog", label: "Changelog", to: "/changelog" },
  { tKey: "feedback", label: "Feedback", to: "/feedback" },
  { tKey: "models", label: "Models", to: "/models" },
];

/**
 * A single hover/click dropdown in the top nav: a `<button>` trigger
 * plus a portal menu anchored beneath it. Hover opens immediately;
 * hover-out closes after a short grace period so the pointer can cross
 * the gap to the menu. Click keeps it open, Escape / outside-click /
 * selecting an item close it. Each instance owns independent state so
 * multiple dropdowns (Expertise, Resources) coexist.
 *
 * Selecting an item closes the menu via the container's `onClick`
 * (clicks on the inner `NavLink`s bubble up), so callers just pass the
 * menu content as `children`.
 */
function NavDropdown({
  label,
  ariaLabel,
  active,
  menuClassName,
  children,
}: {
  readonly label: string;
  readonly ariaLabel: string;
  readonly active: boolean;
  readonly menuClassName?: string;
  readonly children: ReactNode;
}): React.ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

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

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.link} ${styles.resourcesTrigger} ${
          active || menuOpen ? styles.linkActive : ""
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
        {label}
        <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
      </button>
      {menuOpen &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={ariaLabel}
            className={menuClassName ? `${styles.menu} ${menuClassName}` : styles.menu}
            style={{ top: menuPos.top, left: menuPos.left }}
            onClick={closeMenu}
            onMouseEnter={clearCloseTimer}
            onMouseLeave={scheduleClose}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Renders one `/expertise/:slug` menu column (Capabilities or Industries). */
function ExpertiseColumn({
  title,
  entries,
}: {
  readonly title: string;
  readonly entries: readonly ExpertiseEntry[];
}): React.ReactElement {
  return (
    <div className={styles.menuSection}>
      <span className={styles.menuSectionTitle}>{title}</span>
      {entries.map((entry) => (
        <NavLink
          key={entry.slug}
          to={`/expertise/${entry.slug}`}
          role="menuitem"
          className={({ isActive }) =>
            `${styles.menuItem} ${isActive ? styles.menuItemActive : ""}`
          }
        >
          {entry.label}
        </NavLink>
      ))}
    </div>
  );
}

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

  const expertiseActive =
    pathname === "/expertise" || pathname.startsWith("/expertise/");

  const resourcesActive = RESOURCE_LINKS.some(
    (link) => pathname === link.to || pathname.startsWith(`${link.to}/`),
  );

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
      <NavDropdown
        label={t("expertise", { defaultValue: "Expertise" })}
        ariaLabel="Expertise"
        active={expertiseActive}
        menuClassName={styles.menuColumns}
      >
        <ExpertiseColumn
          title={t("capabilities", { defaultValue: "Capabilities" })}
          entries={CAPABILITIES}
        />
        <ExpertiseColumn
          title={t("industries", { defaultValue: "Industries" })}
          entries={INDUSTRIES}
        />
      </NavDropdown>
      <NavDropdown
        label={t("resources", { defaultValue: "Resources" })}
        ariaLabel="Resources"
        active={resourcesActive}
      >
        {RESOURCE_LINKS.map((link) => (
          <NavLink
            key={link.tKey}
            to={link.to}
            role="menuitem"
            className={({ isActive }) =>
              `${styles.menuItem} ${isActive ? styles.menuItemActive : ""}`
            }
          >
            {t(link.tKey, { defaultValue: link.label })}
          </NavLink>
        ))}
      </NavDropdown>
    </nav>
  );
}
