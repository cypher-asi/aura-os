import { startTransition, useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { cn } from "@cypher-asi/zui";
import { Lane } from "../Lane";
import { PanelSearch } from "../PanelSearch";
import { AppSwitchToggle, type AppSwitchOption } from "../AppSwitchToggle";
import { resolveAppSwitchPath } from "../AppSwitchToggle/resolve-switch-path";
import { LeftMenu } from "../../features/left-menu";
import { PublicSessionsPanel } from "../../views/public-chat/PublicSessionsPanel";
import { EarnCreditsButton } from "../EarnCreditsButton";
import { useActiveApp } from "../../hooks/use-active-app";
import { useAppUIStore } from "../../stores/app-ui-store";
import { useSidebarSearchStore } from "../../stores/sidebar-search-store";
import { useSidebarSearch } from "../../hooks/use-sidebar-search";
import { usePublicChatStore } from "../../stores/public-chat-store";
import { apps } from "../../apps/registry";
import type { UIMode } from "../../stores/ui-mode-store";
import shellStyles from "./AuraShell.module.css";
import styles from "./AuraSidebar.module.css";

/**
 * Shared list of apps that contribute a `DesktopLeftMenuPane`. The
 * advanced sidebar body uses `LeftMenu` for these apps and falls
 * back to the app's own `LeftPanel` for everything else — same
 * decision tree DesktopShell ran.
 *
 * `apps/registry` is the canonical bridge between the shared tier
 * and the app modules; this `.flatMap` walks the registry shape
 * without touching individual app implementations.
 */
const sharedDesktopLeftMenuPanes = apps.flatMap((app) => {
  const Pane = app.DesktopLeftMenuPane;
  return Pane ? [{ appId: app.id, Pane }] : [];
});

function usesSharedDesktopLeftMenu(appId: string): boolean {
  return sharedDesktopLeftMenuPanes.some((pane) => pane.appId === appId);
}

const PUBLIC_SEARCH_KEY = "public";

export interface AuraSidebarProps {
  /**
   * Effective UI mode. Drives the body slot and search variant — but
   * NOT the wrapping `<aside>`, the `<Lane>` instance, the
   * `.sidebarHeader`, or the `<PanelSearch>` input. Those keep stable
   * DOM identity across every mode flip so the search-continuity
   * invariant holds.
   */
  mode: UIMode;
  /**
   * True when the user is on `/desktop` in standard mode. Collapses
   * the Lane to 0 width (snap, not animated) so the wallpaper-backed
   * Desktop surface goes edge-to-edge — matching the legacy
   * `DesktopShell` behaviour that was lost in Phase 3's consolidation.
   * `DesktopApp.LeftPanel` returns `null` so the body has nothing to
   * show anyway; the search box would otherwise hang over the
   * wallpaper.
   */
  isDesktop?: boolean;
}

/**
 * Single `<Lane>` (and single `<aside>` wrapper) mounted across
 * every effective mode. Header slot always renders the
 * `<PanelSearch>`. Body slot conditionally renders the public or
 * authed subtree based on `mode`.
 *
 * Phase 3 invariants:
 * - The Lane mount, sidebarHeader div, and PanelSearch input retain
 *   reference-stable DOM identity across the public <-> authed
 *   boundary.
 * - The sidebar Lane writes its current width to the
 *   `--aura-sidebar-width` CSS variable on `documentElement` so the
 *   public-chat surface's centered AURA visual loop stays aligned
 *   regardless of user resize.
 * - Search query value is lifted into `useSidebarSearchStore` (for
 *   the `public` key) and the existing per-app `useAppUIStore.
 *   sidebarQueries` (for the authed mode via `useSidebarSearch`)
 *   so typing survives mode flips.
 */
export function AuraSidebar({ mode, isDesktop = false }: AuraSidebarProps): React.ReactElement {
  const asideRef = useRef<HTMLElement>(null);
  const publicSidebarCollapsed = useAppUIStore((s) => s.publicSidebarCollapsed);
  const authedSidebarCollapsed = useAppUIStore((s) => s.authedSidebarCollapsed);
  const isPublic = mode === "public";
  // Authed-mode collapse: titlebar drawer toggle drives this. The
  // `/desktop` advanced surface forces collapse regardless of the
  // user's stored preference so the wallpaper stays edge-to-edge.
  const authedCollapsed = !isPublic && (isDesktop || authedSidebarCollapsed);
  // Authed footer (`AuthedSidebarFooter` -> `EarnCreditsButton`)
  // mounts whenever we're in an authenticated mode AND the lane is
  // visible (i.e. not the `/desktop` edge-to-edge wallpaper). When
  // mounted, it floats absolutely over the bottom of `.sidebarBody`
  // and the body picks up a `mask-image` fade so list rows visibly
  // dissolve behind the pill instead of stopping above a static
  // footer row. Compute once so both the mask class and the footer
  // render share a single source of truth.
  const hasAuthedFooter = !isPublic && !isDesktop;

  // Publish the active sidebar width (the `<aside>` rather than just
  // the inner Lane) so that when the public Lane is collapsed, the
  // chat surface's background video / vignette still re-centers
  // around the actual chrome width — not 0.
  useAuraSidebarWidthCssVar(asideRef);

  return (
    <aside
      ref={asideRef}
      className={shellStyles.sidebar}
      data-testid="aura-sidebar"
      data-ui-mode={mode}
      data-public-sidebar-collapsed={
        isPublic ? (publicSidebarCollapsed ? "true" : "false") : undefined
      }
      data-authed-sidebar-collapsed={
        !isPublic ? (authedCollapsed ? "true" : "false") : undefined
      }
    >
      {/*
        The public marketing nav (Agents / Code / Pricing /
        Resources) now lives in the centered title slot of
        `AuraTitlebar` (`PublicTopNav`), not in this sidebar. The
        public `<aside>` keeps only its search + recent-chats body
        (`PublicSessionsPanel`).
      */}
      <div
        className={cn(
          shellStyles.sidebarBody,
          hasAuthedFooter && styles.sidebarBodyFadeAboveFooter,
        )}
      >
        <Lane
          // Every mode is now collapsible: public toggles via the
          // titlebar drawer (`publicSidebarCollapsed`), the authed
          // mode toggles the same drawer bound to
          // `authedSidebarCollapsed`, and standard `/desktop`
          // forces collapse (snap, no animation) so the wallpaper
          // extends edge-to-edge — same behaviour the legacy
          // `DesktopShell` had via `collapsed={isDesktop}
          // animateCollapse={false}`. Resizing is gated on the lane
          // being expanded so the drag handle disappears with the
          // panel.
          resizable={
            !isDesktop &&
            (isPublic ? !publicSidebarCollapsed : !authedCollapsed)
          }
          collapsible
          collapsed={isPublic ? publicSidebarCollapsed : authedCollapsed}
          animateCollapse={!isDesktop}
          resizePosition="right"
          defaultWidth={200}
          maxWidth={600}
          storageKey="aura-sidebar"
          header={
            <div
              className={shellStyles.sidebarHeader}
              data-testid="aura-sidebar-header"
            >
              <AuraSidebarSearch mode={mode} />
            </div>
          }
        >
          <SidebarBody mode={mode} />
        </Lane>
      </div>
      {/*
        Authed-mode sidebar footer — pinned to the bottom of the
        `<aside>` via `position: absolute` (the aside owns
        `position: relative`) so the referral pill floats OVER the
        bottom of the Lane body instead of carving out its own row
        in the flex column. The body picks up a `mask-image` fade
        above (via `styles.sidebarBodyFadeAboveFooter`) so list rows
        visibly dissolve as they pass behind the pill.
        `!isDesktop` keeps the pill out of the way when advanced
        `/desktop` collapses the lane edge-to-edge over the wallpaper.
      */}
      {hasAuthedFooter && <AuthedSidebarFooter />}
    </aside>
  );
}

function AuthedSidebarFooter(): React.ReactElement {
  return (
    <div className={styles.authedFooter}>
      <EarnCreditsButton />
    </div>
  );
}

function SidebarBody({ mode }: { mode: UIMode }): React.ReactElement {
  if (mode === "public") {
    return <PublicSidebarBody />;
  }
  // The authed body renders the active-app LeftPanel, resolved via
  // `useActiveApp` without the shell needing to import from
  // `apps/*`. The public nav footer only lives inside
  // `PublicSidebarBody` — it never reaches authed users.
  return <AuthedSidebarBody />;
}

// Primary product switch: conversational assistant vs. coding/build
// workspace. These are the two product modes users need to understand
// before Agents / Marketplace / Tasks become relevant.
const PRIMARY_SWITCH_OPTIONS: readonly AppSwitchOption[] = [
  { id: "chat", label: "Chat" },
  { id: "projects", label: "Build with Aura" },
];

// Advanced workspace switch for users already managing agents.
const WORKSPACE_SWITCH_OPTIONS: readonly AppSwitchOption[] = [
  { id: "projects", label: "Build" },
  { id: "agents", label: "Agents" },
];
const APP_SWITCH_PATHS: Record<string, string> = {
  agents: "/agents",
  chat: "/chat",
  projects: "/projects",
};

function AuthedSidebarBody(): React.ReactElement {
  const activeApp = useActiveApp();
  const visitedAppIds = useAppUIStore((s) => s.visitedAppIds);
  const markAppVisited = useAppUIStore((s) => s.markAppVisited);
  const navigate = useNavigate();
  const { pathname, search } = useLocation();

  // Warm the sibling switch pane so the FIRST Agents <-> Projects switch is
  // also keep-alive. `LeftMenu` only renders a pane once its app is visited;
  // pre-marking the other switch app visited mounts its list (hidden via
  // `display: none`) ahead of time, so the very first flip never remounts.
  useEffect(() => {
    if (activeApp.id !== "agents" && activeApp.id !== "projects") return;
    const sibling = activeApp.id === "agents" ? "projects" : "agents";
    apps.find((app) => app.id === sibling)?.preload?.();
    markAppVisited(sibling);
  }, [activeApp.id, markAppVisited]);

  // Defer the route swap into a transition so the (potentially heavy)
  // mount of the target app's nav/main panel is interruptible and never
  // blocks urgent work. The switch's crossfade is composited inside
  // `AppSwitchToggle`, so it runs independently of this mount regardless.
  //
  // `resolveAppSwitchPath` maps to the EQUIVALENT conversation lane in the
  // target app (when the user is in a chat), so `ConversationSurfaceHost`
  // keeps the same lane key mounted across the switch — instant, no remount.
  const handleSwitch = useCallback(
    (id: string): void => {
      if (id !== "agents" && id !== "chat" && id !== "projects") return;
      // Kick the target app's lazy module so its LeftPanel / Sidekick don't
      // flash a Suspense fallback on first switch. The main chat never
      // flashes — it lives in the eager `ConversationSurfaceHost`.
      apps.find((app) => app.id === id)?.preload?.();
      const path = resolveAppSwitchPath(id, pathname, search);
      startTransition(() => navigate(path));
    },
    [navigate, pathname, search],
  );

  const body = usesSharedDesktopLeftMenu(activeApp.id) ? (
    <LeftMenu
      activeAppId={activeApp.id}
      panes={sharedDesktopLeftMenuPanes}
      visitedAppIds={visitedAppIds}
    />
  ) : (
    <div
      className={shellStyles.panelActive}
      data-agent-surface="left-panel"
      data-agent-active-app-id={activeApp.id}
      data-agent-active-app-label={activeApp.label}
      aria-label={`${activeApp.label} navigation panel`}
    >
      <activeApp.LeftPanel />
    </div>
  );

  const switchOptions =
    activeApp.id === "chat" || activeApp.id === "projects"
      ? PRIMARY_SWITCH_OPTIONS
      : activeApp.id === "agents"
        ? WORKSPACE_SWITCH_OPTIONS
        : null;

  if (!switchOptions || !APP_SWITCH_PATHS[activeApp.id]) {
    return body;
  }

  return (
    <div className={styles.appSwitchBody}>
      <AppSwitchToggle
        options={switchOptions}
        active={activeApp.id}
        onChange={handleSwitch}
        variant={switchOptions === PRIMARY_SWITCH_OPTIONS ? "primary" : "default"}
        ariaLabel={
          switchOptions === PRIMARY_SWITCH_OPTIONS
            ? "Switch between Chat and Build with Aura"
            : "Switch between Build and Agents"
        }
      />
      <div className={styles.appSwitchPanelFill}>{body}</div>
    </div>
  );
}

function PublicSidebarBody(): React.ReactElement {
  const [searchQuery] = useSidebarSearchQueryForKey(PUBLIC_SEARCH_KEY);
  return (
    <div className={styles.publicSessionsBody}>
      <PublicSessionsPanel searchQuery={searchQuery} />
    </div>
  );
}

function AuraSidebarSearch({ mode }: { mode: UIMode }): React.ReactElement {
  if (mode === "public") {
    return <PublicSearchBox />;
  }
  return <AuthedSearchBox />;
}

function PublicSearchBox(): React.ReactElement {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useSidebarSearchQueryForKey(PUBLIC_SEARCH_KEY);
  const createSession = usePublicChatStore((s) => s.createSession);

  // Mirrors the previous LoggedOutShell behaviour — reuse the most
  // recent zero-turn session if one already exists; only mint a new
  // id when every existing session has at least one turn. Keeps the
  // sidebar from accumulating orphan "New chat" rows when the user
  // mashes the "+" button.
  const handleNewChat = useCallback((): void => {
    const { sessions, sessionOrder } = usePublicChatStore.getState();
    const existingEmptyId = sessionOrder.find((id) => {
      const session = sessions[id];
      return session != null && session.turns.length === 0;
    });
    const id = existingEmptyId ?? createSession();
    navigate(`/chat?session=${id}`);
  }, [createSession, navigate]);

  return (
    <PanelSearch
      placeholder="Search"
      value={searchQuery}
      onChange={setSearchQuery}
      action={
        <button
          type="button"
          onClick={handleNewChat}
          aria-label="New chat"
          title="New chat"
          style={NEW_CHAT_BUTTON_STYLE}
        >
          <Plus size={14} />
        </button>
      }
    />
  );
}

const NEW_CHAT_BUTTON_STYLE: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--color-text-primary, inherit)",
  borderRadius: 6,
  width: 24,
  height: 24,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
};

function AuthedSearchBox(): React.ReactElement {
  const activeApp = useActiveApp();
  const { query, setQuery, action } = useSidebarSearch();
  return (
    <PanelSearch
      placeholder={activeApp.searchPlaceholder ?? "Search"}
      value={query}
      onChange={setQuery}
      action={action}
    />
  );
}

function useSidebarSearchQueryForKey(
  key: string,
): [string, (value: string) => void] {
  const value = useSidebarSearchStore((s) => s.queries[key] ?? "");
  const setQuery = useSidebarSearchStore((s) => s.setQuery);
  const set = useCallback((next: string): void => setQuery(key, next), [key, setQuery]);
  return [value, set];
}

/**
 * Writes the active sidebar width (the `<aside>` element) to the
 * `--aura-sidebar-width` CSS variable on `<html>` so the public-
 * chat surface (`PublicChatView.module.css`) can offset its
 * centered AURA visual loop / compose panel by half of the
 * sidebar's current width plus the inter-panel gap. The previous
 * implementation hard-coded `calc((-280px - 6px) / 2)` against
 * the old fixed-width sidebar; Phase 3's resizable Lane made
 * that translate magic-number-dependent.
 *
 * Phase 5: the public left drawer can collapse the inner Lane to
 * width 0 while the public nav footer keeps the `<aside>` visible.
 * Measuring the aside (instead of just the Lane) keeps the chat
 * orb correctly centered relative to the actually-rendered
 * sidebar in both expanded and collapsed states.
 *
 * Uses a `ResizeObserver` on the aside ref so the variable
 * updates live as the user drags the lane handle or toggles the
 * drawer. Also publishes `--left-panel-width` for backwards
 * compatibility with the existing DesktopShell-era consumers in
 * `apps/notes/` and `apps/feed/`.
 */
function useAuraSidebarWidthCssVar(
  asideRef: React.RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const el = asideRef.current;
    if (!el) return;
    let lastWidth = -1;
    const apply = (width: number): void => {
      if (width === lastWidth) return;
      lastWidth = width;
      document.documentElement.style.setProperty(
        "--aura-sidebar-width",
        `${width}px`,
      );
      document.documentElement.style.setProperty(
        "--left-panel-width",
        `${width}px`,
      );
    };
    apply(Math.round(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const rawWidth =
        entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      apply(Math.round(rawWidth));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [asideRef]);
}
