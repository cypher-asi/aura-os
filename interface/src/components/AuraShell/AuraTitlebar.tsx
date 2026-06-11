import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SidebarDrawerToggle } from "./SidebarDrawerToggle";
import { ShellTitlebar } from "../ShellTitlebar";
import { MenuBar, MenuShortcuts } from "../MenuBar";
import { WindowControls } from "../WindowControls";
import { UpdatePill } from "../UpdateBanner";
import { PublicTopNav } from "../../views/public-chat/PublicTopNav";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useAppUIStore } from "../../stores/app-ui-store";
import { track } from "../../lib/analytics";
import type { UIMode } from "../../stores/ui-mode-store";
import styles from "./AuraShell.module.css";

export interface AuraTitlebarProps {
  /**
   * Effective UI mode. Drives leading/trailing slot content; the
   * outer `ShellTitlebar` wrapper has stable DOM identity across
   * every mode flip.
   */
  mode: UIMode;
  /**
   * Authenticated-only: whether the Desktop app (`/desktop`) is the
   * active surface. In desktop mode the leading sidebar toggle, the
   * trailing sidekick toggle, and the MenuBar collapse chevron are all
   * suppressed for a clean top bar (the File / Edit / View / Help menus
   * stay). The sidebar and sidekick toggles are dropped upstream by
   * `AuraShell` passing `undefined` callbacks; this flag drives the
   * chevron suppression in `AuthedLeading`.
   */
  isDesktop?: boolean;
  /**
   * Public-only: collapse state of the left sidebar (sessions panel).
   * Drives the `<PanelLeft />` drawer button's `selected` /
   * `aria-pressed` so it lights up when the drawer is open and goes
   * neutral when it is collapsed — the left-side mirror of the
   * `<PanelRight />` sidekick toggle in `WindowControls`.
   */
  publicSidebarCollapsed?: boolean;
  /** Public-only: toggle action for the left drawer. */
  onTogglePublicSidebar?: () => void;
  /**
   * Authenticated-only: collapse state of the authed left sidebar.
   * Drives the same `<PanelLeft />` drawer toggle the public shell
   * uses, just bound to a separate store field so the two shells
   * remember independent positions.
   */
  authedSidebarCollapsed?: boolean;
  /** Authenticated-only: toggle action for the authed left drawer. */
  onToggleAuthedSidebar?: () => void;
  /** Authenticated only: sidekick & split-screen toggles. */
  sidekickCollapsed?: boolean;
  onToggleSidekick?: () => void;
  splitScreenActive?: boolean;
  onToggleSplitScreen?: () => void;
}

/**
 * AuraTitlebar wraps a single `<ShellTitlebar>` instance for every
 * effective UI mode. The wrapper component identity stays stable
 * across mode flips — only its `icon` (leading) and `actions`
 * (trailing) slot children swap based on `mode`. The `title` slot's
 * outer `<span className="titlebar-center">` wrapper is also stable
 * across modes; only its inner content swaps — authenticated modes
 * render the AURA wordmark `<img>`, public mode renders the
 * centered marketing nav (`PublicTopNav`: Agents / Code / Pricing /
 * Resources). The home affordance moved to the clickable AURA logo
 * in the public leading slot, so the nav itself carries no Home
 * link.
 *
 * Layout:
 * - Leading slot (all modes): `<PanelLeft />` drawer toggle that
 *   opens / closes the left sidebar. Mirrors the `<PanelRight />`
 *   sidekick toggle in `WindowControls.tsx` 1:1 — same ZUI `Button`
 *   props (`variant="ghost"`, `size="sm"`, `iconOnly`,
 *   `selected={!collapsed}`, `aria-pressed`) and the same neutral-
 *   text override on `[aria-pressed="true"]`. Public and authed
 *   shells each bind the toggle to their own collapse state so the
 *   two drawers remember independent positions. The authed standard
 *   mode mounts headless `MenuShortcuts` plus the visible `MenuBar`
 *   (File / Edit / View / Help); public mode shows neither.
 *   The team selector (`OrgSelector`) lives in the bottom taskbar's
 *   `.left` cluster (right after `ProfilePill`) instead of the
 *   titlebar. In standard mode the Desktop icon now leads the
 *   `.center` cluster, so it no longer sits adjacent to the org
 *   selector.
 * - Trailing slot:
 *   - Authenticated: `UpdatePill` + `WindowControls` (with the
 *     sidekick / split-screen toggles plumbed through props). The
 *     referral CTA lives in the left
 *     sidebar footer (`AuraSidebar`'s `AuthedSidebarFooter`) — not
 *     in the titlebar.
 *   - Public: Log In / Sign Up / Download pills + `WindowControls`.
 *     The day/night theme toggle is intentionally not in the public
 *     titlebar — it lives only in the bottom-right `BottomTaskbar`
 *     cluster so unauthenticated visitors aren't given two redundant
 *     affordances for the same control. The three trailing pills
 *     read as a deliberate visual hierarchy: "Log In" is the ghost
 *     variant (`.authPillGhost`, no outline), "Sign Up" is the
 *     filled primary CTA (`.authPillPrimary`), and "Download" is
 *     the outlined secondary (`.authPillSecondary`). Download
 *     navigates to the `/download` marketing page (mounted inside
 *     `PublicMarketingPanel` in `App.tsx`).
 */
export function AuraTitlebar(props: AuraTitlebarProps): React.ReactElement {
  const { mode } = props;
  const isPublic = mode === "public";

  return (
    <ShellTitlebar
      data-testid="aura-titlebar"
      icon={
        isPublic ? (
          <PublicLeading />
        ) : (
          <AuthedLeading
            mode={mode}
            isDesktop={props.isDesktop ?? false}
            collapsed={props.authedSidebarCollapsed ?? false}
            onToggle={props.onToggleAuthedSidebar}
          />
        )
      }
      title={
        <span className={`titlebar-center ${styles.titleCenter}`}>
          {isPublic ? (
            <PublicTopNav />
          ) : (
            <img
              src="/AURA_logo_text_mark.png"
              alt="AURA"
              draggable={false}
              className={styles.titleLogo}
              data-aura-wordmark
            />
          )}
        </span>
      }
      actions={
        isPublic ? (
          <PublicActions />
        ) : (
          <AuthedActions
            sidekickCollapsed={props.sidekickCollapsed ?? false}
            onToggleSidekick={props.onToggleSidekick}
            splitScreenActive={props.splitScreenActive ?? false}
            onToggleSplitScreen={props.onToggleSplitScreen}
          />
        )
      }
    />
  );
}

function AuthedLeading({
  mode,
  isDesktop,
  collapsed,
  onToggle,
}: {
  mode: UIMode;
  isDesktop: boolean;
  collapsed: boolean;
  onToggle?: () => void;
}): React.ReactElement {
  // `MenuShortcuts` is headless (`null`) and installs the document-
  // level shortcut listener. The visible `MenuBar` mounts only in the
  // authed standard surface — public mode never shows the
  // File / Edit / View / Help bar.
  const isStandard = mode === "standard";
  const menuBarCollapsed = useAppUIStore((s) => s.menuBarCollapsed);
  const toggleMenuBar = useAppUIStore((s) => s.toggleMenuBar);
  return (
    <span
      className={`${styles.titleLeading} titlebar-no-drag`}
      // The titlebar treats unhandled double-clicks as a window-
      // maximize gesture (see `ShellTitlebar`'s default
      // `onDoubleClick`). Without this stop, a fast double-tap on
      // the drawer toggle ends up maximizing the OS window — the
      // exact same fix `AuthedActions` applies to its trailing
      // cluster, mirrored here for the authed leading slot.
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {onToggle && (
        <SidebarDrawerToggle collapsed={collapsed} onToggle={onToggle} />
      )}
      <MenuShortcuts />
      {/* Desktop mode hides the visible File / Edit / View / Help bar
          (and its collapse chevron) for a clean top bar. `MenuShortcuts`
          stays mounted so the keyboard shortcuts keep working. */}
      {isStandard && !isDesktop && (
        <MenuBar collapsed={menuBarCollapsed} onToggleCollapsed={toggleMenuBar} />
      )}
    </span>
  );
}

function PublicLeading(): React.ReactElement {
  // The AURA wordmark always goes "home" (the `Link` to "/"). When the
  // visitor is already on the homepage and scrolled down, navigating to
  // "/" is a no-op — React Router won't re-mount or reset the landing's
  // own scroll column — so we manually glide that column back to the
  // top. On every other route (e.g. `/agents`) the homepage column
  // isn't mounted, so the click falls through to the normal navigation
  // that lands the visitor on the homepage hero.
  const handleLogoClick = (
    event: React.MouseEvent<HTMLAnchorElement>,
  ): void => {
    const homeColumn = document.querySelector<HTMLElement>(
      "[data-public-home-scroll]",
    );
    if (homeColumn && homeColumn.scrollTop > 0) {
      event.preventDefault();
      homeColumn.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    }
  };

  return (
    <span
      className={`${styles.titleLeading} titlebar-no-drag`}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <Link
        to="/"
        aria-label="AURA home"
        className={styles.titleLogoLink}
        onClick={handleLogoClick}
      >
        <img
          src="/AURA_logo_text_mark.png"
          alt="AURA"
          draggable={false}
          className={styles.titleLogo}
          data-aura-wordmark
        />
      </Link>
    </span>
  );
}

interface AuthedActionsProps {
  sidekickCollapsed: boolean;
  onToggleSidekick?: () => void;
  splitScreenActive: boolean;
  onToggleSplitScreen?: () => void;
}

function AuthedActions({
  sidekickCollapsed,
  onToggleSidekick,
  splitScreenActive,
  onToggleSplitScreen,
}: AuthedActionsProps): React.ReactElement {
  const { remoteOnly } = useAuraCapabilities();
  return (
    <div
      className={styles.titleActions}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {remoteOnly && (
        <Link
          to="/download"
          className={`${styles.authPill} ${styles.authPillSecondary} ${styles.authedDownloadPill}`}
          onClick={() =>
            track("public_download_clicked", { source: "authed_titlebar" })
          }
        >
          Download
        </Link>
      )}
      <UpdatePill />
      <WindowControls
        sidekickCollapsed={sidekickCollapsed}
        // Pass through `undefined` (rather than substituting a no-op
        // function) so `WindowControls` can drop the `Toggle sidekick`
        // / `Toggle split screen` icon buttons entirely when the host
        // has opted out — this is what gives public mode a clean
        // titlebar trailing cluster (min/max/close only).
        onToggleSidekick={onToggleSidekick}
        splitScreenActive={splitScreenActive}
        onToggleSplitScreen={onToggleSplitScreen}
      />
    </div>
  );
}

function PublicActions(): React.ReactElement {
  const location = useLocation();
  const { t } = useTranslation("auth");
  const { search } = location;
  // Preserve any existing query (notably `?session=...`) across the
  // trip into the login modal so the public chat surface stays
  // selected behind the overlay.
  const signinSearch = search || "";
  const signupParams = new URLSearchParams(search);
  signupParams.set("tab", "register");
  const signupSearch = `?${signupParams.toString()}`;

  // Stash the current location as `state.backgroundLocation` so
  // `AppRoutes` keeps the underlying surface (e.g. ProductView,
  // PricingView, the public chat surface) mounted while
  // `AuraShell` overlays `LoginOverlay`. Without this state the
  // current view would unmount and `PublicChatView` would flash
  // in behind the modal.
  const backgroundState = { backgroundLocation: location };

  return (
    <div className={`${styles.publicTitleActions} titlebar-no-drag`}>
      <Link
        to={{ pathname: "/login", search: signinSearch }}
        state={backgroundState}
        className={`${styles.authPill} ${styles.authPillGhost}`}
        onClick={() => track("public_login_clicked", { source: "titlebar" })}
      >
        {t("logIn", { defaultValue: "Log In" })}
      </Link>
      <Link
        to={{ pathname: "/login", search: signupSearch }}
        state={backgroundState}
        className={`${styles.authPill} ${styles.authPillPrimary}`}
        onClick={() => track("public_signup_clicked", { source: "titlebar" })}
      >
        {t("signUp", { defaultValue: "Sign Up" })}
      </Link>
      <Link
        to="/download"
        className={`${styles.authPill} ${styles.authPillSecondary}`}
        onClick={() => track("public_download_clicked", { source: "titlebar" })}
      >
        {t("download", { defaultValue: "Download" })}
      </Link>
      <WindowControls />
    </div>
  );
}
