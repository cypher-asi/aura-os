import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { ChevronRight, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { track } from "../../../lib/analytics";
import { useLanguageStore } from "../../../stores/language-store";
import { LANGUAGES } from "../../../i18n/languages";
import {
  CAPABILITIES,
  INDUSTRIES,
} from "../../../views/marketing/ExpertiseDetailView/expertiseData";
import { isMarketingExpertiseEnabled } from "../../../shared/lib/featureFlags";
import {
  PRIMARY_LINKS,
  RESOURCE_LINKS,
  type TopNavLink,
} from "../../../views/public-chat/PublicTopNav/nav-links";
import styles from "./MobilePublicMenu.module.css";

/**
 * Full-screen public navigation menu for the mobile public shell.
 *
 * Opened from the hamburger button in `MobilePublicShell`'s topbar.
 * Mirrors the desktop `PublicTopNav` areas exactly (it imports the
 * same `PRIMARY_LINKS` / `RESOURCE_LINKS` arrays): Agents, Code, and
 * Pricing as flat rows, plus an expandable `Resources` group (the
 * only row with a chevron — tap to reveal Blog, Changelog, Downloads,
 * Feedback, Models, OS). `Expertise` mounts behind the same
 * `isMarketingExpertiseEnabled()` flag desktop uses.
 *
 * The footer carries the language selector and the Log In / Sign Up
 * pills (background-location overlay pattern, mirroring desktop's
 * `PublicActions`).
 *
 * Stays mounted while closed so the open/close fade can animate;
 * `inert` + `aria-hidden` keep the closed menu out of the focus
 * order and pointer map.
 */

type ExpandableGroupId = "expertise" | "resources";

interface MobilePublicMenuProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/** One expandable group row (chevron trigger + indented sub-links). */
function MenuGroup({
  id,
  label,
  active,
  expanded,
  onToggle,
  children,
}: {
  readonly id: ExpandableGroupId;
  readonly label: string;
  readonly active: boolean;
  readonly expanded: boolean;
  readonly onToggle: (id: ExpandableGroupId) => void;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className={styles.group}>
      <button
        type="button"
        className={`${styles.row} ${styles.groupTrigger} ${
          active ? styles.rowActive : ""
        }`}
        aria-expanded={expanded}
        aria-controls={`mobile-public-menu-group-${id}`}
        onClick={() => onToggle(id)}
      >
        {label}
        <ChevronRight
          size={20}
          strokeWidth={2}
          aria-hidden="true"
          className={`${styles.chevron} ${expanded ? styles.chevronOpen : ""}`}
        />
      </button>
      {/* Conditional render (not `hidden`) — the attribute's default
          `display: none` would lose to the class's `display: flex`. */}
      {expanded ? (
        <div
          id={`mobile-public-menu-group-${id}`}
          className={styles.groupItems}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function MobilePublicMenu({
  open,
  onClose,
}: MobilePublicMenuProps): React.ReactElement {
  const location = useLocation();
  const { t } = useTranslation(["nav", "auth", "common", "publicChat", "marketing"]);
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  const [expandedGroup, setExpandedGroup] = useState<ExpandableGroupId | null>(
    null,
  );

  const toggleGroup = (id: ExpandableGroupId): void => {
    setExpandedGroup((prev) => (prev === id ? null : id));
  };

  // Body-scroll lock + Escape-to-dismiss while the menu is open —
  // carried over from the old slide-in drawer in `MobilePublicShell`.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose]);

  const expertiseActive =
    location.pathname === "/expertise" ||
    location.pathname.startsWith("/expertise/");
  const resourcesActive = RESOURCE_LINKS.some(
    (link) =>
      location.pathname === link.to ||
      location.pathname.startsWith(`${link.to}/`),
  );

  // Login overlay state piggybacks on the desktop pattern: navigate
  // to `/login?tab=...` with `state.backgroundLocation` so the
  // overlay paints over whichever public route the visitor was on.
  const signinSearch = location.search || "";
  const signupParams = new URLSearchParams(location.search);
  signupParams.set("tab", "register");
  const signupSearch = `?${signupParams.toString()}`;
  const backgroundState = { backgroundLocation: location };

  const navLinkClassName = ({ isActive }: { isActive: boolean }): string =>
    `${styles.row} ${isActive ? styles.rowActive : ""}`;
  const subLinkClassName = ({ isActive }: { isActive: boolean }): string =>
    `${styles.subRow} ${isActive ? styles.subRowActive : ""}`;

  const renderSubLink = (link: TopNavLink): React.ReactElement => (
    <NavLink
      key={link.tKey}
      to={link.to}
      className={subLinkClassName}
      onClick={onClose}
    >
      {t(`nav:${link.tKey}`, { defaultValue: link.label })}
    </NavLink>
  );

  return (
    <div
      id="mobile-public-menu"
      role="dialog"
      // Only claim modality while actually open — a closed, inert overlay
      // isn't a modal, and the global `:has([aria-modal="true"])` scroll
      // lock (index.css) must not see the closed menu or it would pin
      // html/body to `overflow: hidden` on every mobile public route.
      aria-modal={open ? "true" : undefined}
      aria-label={t("publicChat:mobileShell.publicNavigation", {
        defaultValue: "Public navigation",
      })}
      aria-hidden={!open}
      inert={!open}
      className={`${styles.overlay} ${open ? styles.overlayOpen : ""}`}
      data-testid="mobile-public-menu"
    >
      <header className={styles.header}>
        {/*
          Decorative wordmark — deliberately NOT a home link so the
          shell's topbar logo stays the single "AURA home" target
          (duplicate identical labels would be an a11y smell, and the
          X / nav rows cover every exit from the menu).
        */}
        <img
          src="/AURA_logo_text_mark.png"
          alt="AURA"
          className={styles.logo}
          draggable={false}
          data-aura-wordmark
        />
        <div className={styles.headerActions}>
          {/* Compact language selector — shows the 2-letter code (e.g.
              "EN") and sits just left of the close button. */}
          <select
            className={styles.languageSelect}
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            aria-label={t("common:language", { defaultValue: "Language" })}
            title={t("common:language", { defaultValue: "Language" })}
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.code.slice(0, 2).toUpperCase()}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.closeButton}
            aria-label={t("publicChat:mobileShell.closeMenu", {
              defaultValue: "Close menu",
            })}
            onClick={onClose}
            data-testid="mobile-public-menu-close"
          >
            <X size={24} aria-hidden="true" />
          </button>
        </div>
      </header>

      <nav
        className={styles.nav}
        aria-label={t("publicChat:mobileShell.publicSections", {
          defaultValue: "Public sections",
        })}
      >
        {/* Dedicated chat page — the public landing hero no longer
            embeds the composer, so this is the menu's entry into it. */}
        <NavLink to="/chat" className={navLinkClassName} onClick={onClose}>
          {t("publicChat:mobileChat.chatNav", { defaultValue: "Chat" })}
        </NavLink>
        {PRIMARY_LINKS.map((link) => (
          <NavLink
            key={link.tKey}
            to={link.to}
            className={navLinkClassName}
            onClick={onClose}
          >
            {t(`nav:${link.tKey}`, { defaultValue: link.label })}
          </NavLink>
        ))}
        {isMarketingExpertiseEnabled() && (
          <MenuGroup
            id="expertise"
            label={t("nav:expertise", { defaultValue: "Expertise" })}
            active={expertiseActive}
            expanded={expandedGroup === "expertise"}
            onToggle={toggleGroup}
          >
            <span className={styles.subGroupTitle}>
              {t("nav:capabilities", { defaultValue: "Capabilities" })}
            </span>
            {CAPABILITIES.map((entry) => (
              <NavLink
                key={entry.slug}
                to={`/expertise/${entry.slug}`}
                className={subLinkClassName}
                onClick={onClose}
              >
                {t(`marketing:expertise.entries.${entry.slug}.label`, {
                  defaultValue: entry.label,
                })}
              </NavLink>
            ))}
            <span className={styles.subGroupTitle}>
              {t("nav:industries", { defaultValue: "Industries" })}
            </span>
            {INDUSTRIES.map((entry) => (
              <NavLink
                key={entry.slug}
                to={`/expertise/${entry.slug}`}
                className={subLinkClassName}
                onClick={onClose}
              >
                {t(`marketing:expertise.entries.${entry.slug}.label`, {
                  defaultValue: entry.label,
                })}
              </NavLink>
            ))}
          </MenuGroup>
        )}
        <MenuGroup
          id="resources"
          label={t("nav:resources", { defaultValue: "Resources" })}
          active={resourcesActive}
          expanded={expandedGroup === "resources"}
          onToggle={toggleGroup}
        >
          {RESOURCE_LINKS.map(renderSubLink)}
        </MenuGroup>
      </nav>

      <div className={styles.footer}>
        <Link
          to={{ pathname: "/login", search: signinSearch }}
          state={backgroundState}
          className={`${styles.authPill} ${styles.authPillSecondary}`}
          onClick={() => {
            onClose();
            track("public_login_clicked", { source: "mobile_menu" });
          }}
        >
          {t("auth:logIn", { defaultValue: "Log In" })}
        </Link>
        <Link
          to={{ pathname: "/login", search: signupSearch }}
          state={backgroundState}
          className={`${styles.authPill} ${styles.authPillPrimary}`}
          onClick={() => {
            onClose();
            track("public_signup_clicked", { source: "mobile_menu" });
          }}
        >
          {t("auth:signUp", { defaultValue: "Sign Up" })}
        </Link>
      </div>
    </div>
  );
}
