import {
  Fragment,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocation, useOutlet } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { BackgroundLayer } from "../DesktopShell/BackgroundLayer";
import { PersistentSidekickLane } from "../DesktopShell/PersistentSidekickLane";
import { SidekickPortalBridge } from "../DesktopShell/SidekickPortalBridge";
import {
  DEFAULT_SIDEKICK_WIDTH,
  persistSidekickWidth,
  readStoredSidekickWidth,
  SIDEKICK_MIN_WIDTH,
} from "../DesktopShell/desktop-shell-sidekick";
import { ResponsiveMainLane } from "../ResponsiveMainLane";
import { ConversationSurfaceHost } from "../ConversationSurfaceHost";
import { ErrorBoundary } from "../ErrorBoundary";
import { BottomTaskbar } from "../BottomTaskbar";
import { useActiveApp } from "../../hooks/use-active-app";
import { useAppUIStore } from "../../stores/app-ui-store";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { useDesktopBackgroundStore } from "../../stores/desktop-background-store";
import { useDesktopWindowStore } from "../../stores/desktop-window-store";
import { useEffectiveMode } from "../../stores/use-effective-mode";
import { AuraTitlebar } from "./AuraTitlebar";
import { AuraSidebar } from "./AuraSidebar";
import type { LaneResizeControls } from "../Lane";
import type { UIMode } from "../../stores/ui-mode-store";
import styles from "./AuraShell.module.css";

const DesktopWindowLayer = lazy(() =>
  import("../../apps/agents/components/AgentWindow").then((module) => ({
    default: module.DesktopWindowLayer,
  })),
);
const ChangelogModal = lazy(() =>
  import("../ChangelogModal").then((module) => ({
    default: module.ChangelogModal,
  })),
);
const DownloadsModal = lazy(() =>
  import("../DownloadsModal").then((module) => ({
    default: module.DownloadsModal,
  })),
);

function blurActiveElement(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    active.blur();
  }
}

/**
 * AuraShell — the single mounted-once desktop shell for every
 * effective UI mode (`public` / `standard`). Mounts:
 *   - `<AuraTitlebar />` (one instance, slot composition by mode)
 *   - `<div className={styles.body}>` containing
 *     `<BackgroundLayer />` (theme wallpaper; authed modes only —
 *     suppressed in `public` so the persisted desktop wallpaper never
 *     bleeds onto logged-out surfaces) plus sidebar / main /
 *     conditional sidekick. In standard mode `.body` fills the region
 *     between the chrome with a slim inset and rounded corners, floating
 *     on the gradient outer-shell backdrop so the top bar and bottom
 *     taskbar read as a shell around the contained desktop.
 *   - `<AuraSidebar />` (one Lane instance, conditional body)
 *   - `<main>` (one element, content varies by mode)
 *   - `<BottomTaskbar />` (one `.bar`, mode-aware children)
 *
 * Phase 3 load-bearing invariants:
 * - The outer `.shell` div, `<AuraTitlebar>`, `<AuraSidebar>`'s Lane,
 *   sidebarHeader, `<main>`, and `<BottomTaskbar>` `.bar` retain
 *   reference-stable DOM identity across every mode flip and
 *   login/logout transition. Mode flips swap subtree contents inside
 *   slots; React reconciles in place because every slot's *wrapping
 *   element identity* is unconditional.
 * - `--shell-chrome-outer-height` row reserved by `<BottomTaskbar>`
 *   is present in every mode so the main panel's bottom edge does
 *   not move on flip.
 * - `--aura-sidebar-width` CSS variable, published by `<AuraSidebar>`,
 *   replaces the previous hard-coded 280px sidebar width assumption.
 */
export function AuraShell(): React.ReactElement {
  const mode = useEffectiveMode();
  const isPublic = mode === "public";
  // Authenticated users get the full standard shell: wallpaper, the
  // right sidekick lane, titlebar split/sidekick toggles, and the
  // host settings entry. Public mode strips all of it.
  const isStandard = mode === "standard";

  // The public marketing /agents, /code, and /os routes paint a dark-mode
  // diagonal gradient on the shell frame (see `.shell::before` in
  // AuraShell.module.css). Flag them so the CSS can fade it in/out.
  const { pathname } = useLocation();
  const publicGradientSurface =
    isPublic &&
    (pathname === "/agents" ||
      pathname === "/code" ||
      pathname === "/os" ||
      pathname.startsWith("/os/"));

  // Authed-side state. We call these hooks unconditionally because
  // their subscriptions are cheap store reads — `useAppUIStore`,
  // `useUIModalStore`, `useActiveApp`, etc. are pure derivations
  // with no auth-required side effects. Their results are unused in
  // public mode (the slot doesn't render the corresponding chrome).
  const activeApp = useActiveApp();
  const sidekickCollapsed = useAppUIStore((s) => s.sidekickCollapsed);
  const toggleSidekick = useAppUIStore((s) => s.toggleSidekick);
  const sidekickSplitScreen = useAppUIStore((s) => s.sidekickSplitScreen);
  const setSidekickSplitScreen = useAppUIStore((s) => s.setSidekickSplitScreen);
  const publicSidebarCollapsed = useAppUIStore((s) => s.publicSidebarCollapsed);
  const togglePublicSidebar = useAppUIStore((s) => s.togglePublicSidebar);
  const authedSidebarCollapsed = useAppUIStore((s) => s.authedSidebarCollapsed);
  const toggleAuthedSidebar = useAppUIStore((s) => s.toggleAuthedSidebar);
  const {
    changelogModalOpen,
    closeChangelog,
    downloadsModalOpen,
    closeDownloads,
  } = useUIModalStore(
    useShallow((s) => ({
      changelogModalOpen: s.changelogModalOpen,
      closeChangelog: s.closeChangelog,
      downloadsModalOpen: s.downloadsModalOpen,
      closeDownloads: s.closeDownloads,
    })),
  );
  const backgroundHydrated = useDesktopBackgroundStore((s) => s.hydrated);
  const openDesktopWindowCount = useDesktopWindowStore(
    (state) => Object.keys(state.windows).length,
  );

  const isDesktop = isStandard && activeApp.id === "desktop";
  const desktopModeActive = isDesktop && backgroundHydrated;
  const hasActiveSidekick =
    isStandard && Boolean(activeApp.SidekickPanel) && !isDesktop;
  const sidekickHostCollapsed = sidekickCollapsed || !hasActiveSidekick;
  const showSidekickHeader = hasActiveSidekick && Boolean(activeApp.SidekickTaskbar);
  const splitScreenActive = sidekickSplitScreen && hasActiveSidekick;

  const desktopContentRef = useRef<HTMLDivElement>(null);
  const mainPanelHostRef = useRef<HTMLElement>(null);
  const sidekickLaneRef = useRef<HTMLDivElement>(null);
  const sidekickResizeControlsRef = useRef<LaneResizeControls | null>(null);
  const programmaticResizeRef = useRef(false);
  const [sidekickInitialWidth] = useState(() => readStoredSidekickWidth());
  const [sidekickHeaderTarget, setSidekickHeaderTarget] =
    useState<HTMLDivElement | null>(null);
  const [sidekickPanelTarget, setSidekickPanelTarget] =
    useState<HTMLDivElement | null>(null);

  const handleSidekickHeaderTargetChange = useCallback(
    (node: HTMLDivElement | null) => {
      setSidekickHeaderTarget((currentNode) =>
        currentNode === node ? currentNode : node,
      );
    },
    [],
  );

  const handleSidekickPanelTargetChange = useCallback(
    (node: HTMLDivElement | null) => {
      setSidekickPanelTarget((currentNode) =>
        currentNode === node ? currentNode : node,
      );
    },
    [],
  );

  const handleSidekickResizeEnd = useCallback((size: number) => {
    if (programmaticResizeRef.current) return;
    persistSidekickWidth(size);
  }, []);

  const handleSidekickResize = useCallback(() => {
    if (programmaticResizeRef.current) return;
    setSidekickSplitScreen(false);
  }, [setSidekickSplitScreen]);

  const computeSplitTargetWidth = useCallback((): number | null => {
    const mainEl = mainPanelHostRef.current;
    const sidekickEl = sidekickLaneRef.current;
    if (!mainEl || !sidekickEl) return null;
    const mainOuter = mainEl.offsetWidth;
    const sidekickOuter = sidekickEl.offsetWidth;
    const budget = mainOuter + sidekickOuter;
    if (budget <= 0) return null;
    const half = Math.floor(budget / 2);
    const maxAllowed = Math.max(SIDEKICK_MIN_WIDTH, budget - SIDEKICK_MIN_WIDTH);
    return Math.min(Math.max(SIDEKICK_MIN_WIDTH, half), maxAllowed);
  }, []);

  const applySplitTargetWidth = useCallback(() => {
    const controls = sidekickResizeControlsRef.current;
    if (!controls) return;
    const target = computeSplitTargetWidth();
    if (target == null) return;
    programmaticResizeRef.current = true;
    controls.setSize(target);
    requestAnimationFrame(() => {
      programmaticResizeRef.current = false;
    });
  }, [computeSplitTargetWidth]);

  const handleToggleSplitScreen = useCallback((): void => {
    if (!hasActiveSidekick) return;
    if (splitScreenActive) {
      programmaticResizeRef.current = true;
      sidekickResizeControlsRef.current?.setSize(DEFAULT_SIDEKICK_WIDTH);
      persistSidekickWidth(DEFAULT_SIDEKICK_WIDTH);
      requestAnimationFrame(() => {
        programmaticResizeRef.current = false;
      });
      setSidekickSplitScreen(false);
      return;
    }
    if (sidekickCollapsed) {
      toggleSidekick();
    }
    setSidekickSplitScreen(true);
    applySplitTargetWidth();
  }, [
    applySplitTargetWidth,
    hasActiveSidekick,
    setSidekickSplitScreen,
    sidekickCollapsed,
    splitScreenActive,
    toggleSidekick,
  ]);

  useEffect(() => {
    if (!splitScreenActive) return;
    const contentEl = desktopContentRef.current;
    if (!contentEl) return;
    applySplitTargetWidth();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      applySplitTargetWidth();
    });
    observer.observe(contentEl);
    return () => {
      observer.disconnect();
    };
  }, [applySplitTargetWidth, splitScreenActive]);

  useEffect(() => {
    if (sidekickSplitScreen && !hasActiveSidekick) {
      setSidekickSplitScreen(false);
    }
  }, [hasActiveSidekick, setSidekickSplitScreen, sidekickSplitScreen]);

  return (
    <>
      <div
        className={styles.shell}
        data-ui-mode={mode}
        data-desktop-mode={desktopModeActive || undefined}
        data-public-surface={publicGradientSurface ? "agents-code" : undefined}
        data-testid="aura-shell"
        data-agent-context={isPublic ? "logged-out-shell" : "desktop-shell"}
      >
        <AuraTitlebar
          mode={mode}
          isDesktop={isDesktop}
          publicSidebarCollapsed={publicSidebarCollapsed}
          onTogglePublicSidebar={isPublic ? togglePublicSidebar : undefined}
          authedSidebarCollapsed={authedSidebarCollapsed}
          onToggleAuthedSidebar={!isPublic && !isDesktop ? toggleAuthedSidebar : undefined}
          sidekickCollapsed={sidekickCollapsed}
          onToggleSidekick={isStandard && !isDesktop ? toggleSidekick : undefined}
          splitScreenActive={splitScreenActive}
          onToggleSplitScreen={
            isStandard && hasActiveSidekick ? handleToggleSplitScreen : undefined
          }
        />
        <div
          ref={desktopContentRef}
          className={styles.body}
        >
          {isStandard && <BackgroundLayer />}
          <AuraSidebar mode={mode} isDesktop={isDesktop} />
          <MainPanelSlot
            mode={mode}
            mainPanelHostRef={mainPanelHostRef}
          />
          {isStandard && (
            <>
              {hasActiveSidekick && (
                <ErrorBoundary name="sidekick">
                  <SidekickPortalBridge
                    headerTarget={sidekickHeaderTarget}
                    panelTarget={sidekickPanelTarget}
                  />
                </ErrorBoundary>
              )}
              <PersistentSidekickLane
                collapsed={sidekickHostCollapsed}
                defaultWidth={sidekickInitialWidth}
                showHeaderSlot={showSidekickHeader}
                maxWidth={splitScreenActive ? Number.POSITIVE_INFINITY : undefined}
                laneRef={sidekickLaneRef}
                resizeControlsRef={sidekickResizeControlsRef}
                onResize={handleSidekickResize}
                onResizeEnd={handleSidekickResizeEnd}
                onHeaderTargetChange={handleSidekickHeaderTargetChange}
                onPanelTargetChange={handleSidekickPanelTargetChange}
              />
              {openDesktopWindowCount > 0 ? (
                <ErrorBoundary name="windows">
                  <div data-window-layer-host="true" style={WINDOW_LAYER_STYLE}>
                    <Suspense fallback={null}>
                      <DesktopWindowLayer />
                    </Suspense>
                  </div>
                </ErrorBoundary>
              ) : null}
            </>
          )}
        </div>
        <BottomTaskbar mode={mode} />
      </div>
      {isStandard && changelogModalOpen ? (
        <Suspense fallback={null}>
          <ChangelogModal
            isOpen={changelogModalOpen}
            onClose={() => {
              blurActiveElement();
              closeChangelog();
            }}
          />
        </Suspense>
      ) : null}
      {isStandard && downloadsModalOpen ? (
        <Suspense fallback={null}>
          <DownloadsModal
            isOpen={downloadsModalOpen}
            onClose={() => {
              blurActiveElement();
              closeDownloads();
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}

interface MainPanelSlotProps {
  mode: UIMode;
  mainPanelHostRef: React.RefObject<HTMLElement | null>;
}

/**
 * Single `<main>` element that mounts across every mode. Its
 * content varies — public renders the route's `<Outlet />`
 * directly, authed wraps it with the active app's `MainPanel`
 * inside `ResponsiveMainLane` + `ErrorBoundary` (matching
 * DesktopShell's previous behaviour). The `<main>` element
 * identity stays stable across mode flips.
 */
function MainPanelSlot({ mode, mainPanelHostRef }: MainPanelSlotProps): React.ReactElement {
  const isPublic = mode === "public";
  return (
    <main
      ref={mainPanelHostRef}
      className={styles.mainPanel}
      data-testid="aura-shell-main"
      data-ui-mode={mode}
    >
      {isPublic ? <PublicMainContent /> : <AuthedMainContent />}
    </main>
  );
}

function PublicMainContent(): React.ReactElement {
  const routeContent = useOutlet();
  return <>{routeContent}</>;
}

function AuthedMainContent(): React.ReactElement {
  const activeApp = useActiveApp();
  const routeContent = useOutlet();
  const { MainPanel } = activeApp;
  const ActiveProvider = activeApp.Provider ?? Fragment;
  const appContent = (
    <ActiveProvider>
      <ErrorBoundary name="main">
        <MainPanel>{routeContent}</MainPanel>
      </ErrorBoundary>
    </ActiveProvider>
  );
  if (activeApp.bareMainPanel) {
    return appContent;
  }
  // `ConversationSurfaceHost` is a STABLE sibling of the per-app `MainPanel`:
  // it never depends on `activeApp`, so it survives every Agents <-> Projects
  // switch and keeps the agent chat mounted (keyed by conversation lane). On
  // chat routes the app's `MainPanel` wraps an empty outlet; the host paints
  // the chat. On other routes the host hides itself and the outlet renders.
  return (
    <ResponsiveMainLane>
      <ErrorBoundary name="conversation">
        <ConversationSurfaceHost />
      </ErrorBoundary>
      {appContent}
    </ResponsiveMainLane>
  );
}

const WINDOW_LAYER_STYLE: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 1000,
  pointerEvents: "none",
};
