import {
  Fragment,
  Suspense,
  useCallback,
  useEffect,
  lazy,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useOutlet } from "react-router-dom";
import { Topbar, Button } from "@cypher-asi/zui";
import { PanelRight, Server } from "lucide-react";
import { Lane, type LaneResizeControls } from "../Lane";
import { BottomTaskbar } from "../BottomTaskbar";
import { OrgSelector } from "../OrgSelector";
import { ErrorBoundary } from "../ErrorBoundary";
import { UpdateBanner } from "../UpdateBanner";
import { PanelSearch } from "../PanelSearch";
import { WindowControls } from "../WindowControls";
import { useActiveApp } from "../../hooks/use-active-app";
import { useSidebarSearch } from "../../hooks/use-sidebar-search";
import { apps } from "../../apps/registry";

import { useAppUIStore } from "../../stores/app-ui-store";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { useDesktopBackgroundStore } from "../../stores/desktop-background-store";
import { useShallow } from "zustand/react/shallow";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { windowCommand } from "../../lib/windowCommand";
import { LeftMenu } from "../../features/left-menu";
import {
  SIDEKICK_MAX_WIDTH,
  SIDEKICK_MIN_WIDTH,
  getSidekickTargetWidth,
  persistSidekickWidth,
  readStoredSidekickWidth,
} from "./desktop-shell-sidekick";
import { useDesktopWindowStore } from "../../stores/desktop-window-store";
import styles from "./DesktopShell.module.css";

const DesktopWindowLayer = lazy(() =>
  import("../AgentWindow").then((module) => ({ default: module.DesktopWindowLayer })),
);
const HostSettingsModal = lazy(() =>
  import("../HostSettingsModal").then((module) => ({ default: module.HostSettingsModal })),
);

const sharedDesktopLeftMenuPanes = apps
  .filter((app) => Boolean(app.DesktopLeftMenuPane))
  .map((app) => ({
    appId: app.id,
    Pane: app.DesktopLeftMenuPane!,
  }));

function usesSharedDesktopLeftMenu(appId: string): boolean {
  return sharedDesktopLeftMenuPanes.some((pane) => pane.appId === appId);
}

function blurActiveElement() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    active.blur();
  }
}

function BackgroundLayer() {
  const mode = useDesktopBackgroundStore((s) => s.mode);
  const color = useDesktopBackgroundStore((s) => s.color);
  const imageDataUrl = useDesktopBackgroundStore((s) => s.imageDataUrl);
  const hydrated = useDesktopBackgroundStore((s) => s.hydrated);

  if (!hydrated || mode === "none") return null;
  if (mode === "image" && !imageDataUrl) return null;

  const style: React.CSSProperties =
    mode === "color"
      ? { backgroundColor: color }
      : { backgroundImage: `url(${imageDataUrl})`, backgroundSize: "cover", backgroundPosition: "center" };

  return <div className={styles.backgroundLayer} style={style} />;
}

function SidebarSearchInput() {
  const { query, setQuery, action } = useSidebarSearch();
  const activeApp = useActiveApp();

  return (
    <PanelSearch
      placeholder={activeApp.searchPlaceholder ?? "Search"}
      value={query}
      onChange={setQuery}
      action={action}
    />
  );
}

function SidekickPortalBridge({
  headerTarget,
  panelTarget,
}: {
  headerTarget: HTMLDivElement | null;
  panelTarget: HTMLDivElement | null;
}) {
  const activeApp = useActiveApp();
  const { SidekickPanel, SidekickTaskbar } = activeApp;

  if (!SidekickPanel || !panelTarget) return null;

  return (
    <>
      {SidekickTaskbar && headerTarget
        ? createPortal(<SidekickTaskbar />, headerTarget)
        : null}
      {createPortal(<SidekickPanel />, panelTarget)}
    </>
  );
}

function PersistentSidekickLane({
  resizeControlsRef,
  collapsed,
  defaultWidth,
  showHeaderSlot,
  onResizeEnd,
  onHeaderTargetChange,
  onPanelTargetChange,
}: {
  resizeControlsRef?: { current: LaneResizeControls | null };
  collapsed: boolean;
  defaultWidth: number;
  showHeaderSlot: boolean;
  onResizeEnd: (size: number) => void;
  onHeaderTargetChange: (node: HTMLDivElement | null) => void;
  onPanelTargetChange: (node: HTMLDivElement | null) => void;
}) {
  return (
    <Lane
      resizable
      resizePosition="left"
      defaultWidth={defaultWidth}
      minWidth={SIDEKICK_MIN_WIDTH}
      maxWidth={SIDEKICK_MAX_WIDTH}
      storageKey={null}
      collapsible
      collapsed={collapsed}
      animateResizeRelease={false}
      resizeControlsRef={resizeControlsRef}
      onResizeEnd={onResizeEnd}
      className={styles.sidekickLane}
      header={
        showHeaderSlot ? (
          <div
            ref={onHeaderTargetChange}
            className={styles.sidekickHeaderSlot}
          />
        ) : undefined
      }
    >
      <div className={styles.sidekickPanels}>
        <div
          ref={onPanelTargetChange}
          className={styles.sidekickPanelSlot}
        />
      </div>
    </Lane>
  );
}

export function DesktopShell() {
  const activeApp = useActiveApp();
  const { features } = useAuraCapabilities();
  const visitedAppIds = useAppUIStore((s) => s.visitedAppIds);
  const sidekickCollapsed = useAppUIStore((s) => s.sidekickCollapsed);
  const toggleSidekick = useAppUIStore((s) => s.toggleSidekick);
  const { hostSettingsOpen, openHostSettings, closeHostSettings } = useUIModalStore(
    useShallow((s) => ({
      hostSettingsOpen: s.hostSettingsOpen,
      openHostSettings: s.openHostSettings,
      closeHostSettings: s.closeHostSettings,
    })),
  );
  const routeContent = useOutlet();
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const mainPanelRef = useRef<HTMLDivElement>(null);
  const sidekickResizeControlsRef = useRef<LaneResizeControls | null>(null);
  const previousSidekickAppIdRef = useRef<string | null>(null);
  const [sidekickInitialWidth] = useState(() =>
    readStoredSidekickWidth(activeApp.id),
  );
  const [sidekickHeaderTarget, setSidekickHeaderTarget] =
    useState<HTMLDivElement | null>(null);
  const [sidekickPanelTarget, setSidekickPanelTarget] =
    useState<HTMLDivElement | null>(null);
  const openDesktopWindowCount = useDesktopWindowStore((state) => Object.keys(state.windows).length);
  const backgroundHydrated = useDesktopBackgroundStore((s) => s.hydrated);
  const { MainPanel } = activeApp;
  const ActiveProvider = activeApp.Provider ?? Fragment;
  const isDesktop = activeApp.id === "desktop";
  const desktopModeActive = isDesktop && backgroundHydrated;
  const hasActiveSidekick = Boolean(activeApp.SidekickPanel) && !isDesktop;
  const sidekickHostCollapsed = sidekickCollapsed || !hasActiveSidekick;
  const showSidekickHeader = hasActiveSidekick && Boolean(activeApp.SidekickTaskbar);

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

  const handleSidekickResizeEnd = useCallback(
    (size: number) => {
      persistSidekickWidth(activeApp.id, size);
    },
    [activeApp.id],
  );


  // Keep `--left-panel-width` in sync with the actual sidebar width.
  //
  // We measure synchronously in a layout effect (before paint) whenever the
  // active app or desktop-mode collapse state changes, because the CSS var
  // drives horizontal centering in app panels (e.g. Notes' centerColumn). If
  // the var lagged the sidebar's width by a frame, the first paint after an
  // app switch would position content against the previous sidebar width —
  // producing a visible flicker as text jumps to its final column.
  //
  // The ResizeObserver then handles ongoing resize drags; it also writes the
  // var synchronously (no rAF batching) so paints during a drag stay aligned.
  useLayoutEffect(() => {
    const el = leftPanelRef.current;
    if (!el) return;
    const width = Math.round(el.getBoundingClientRect().width);
    document.documentElement.style.setProperty("--left-panel-width", `${width}px`);
  }, [isDesktop, activeApp.id]);

  useEffect(() => {
    const el = leftPanelRef.current;
    if (!el) return;
    let lastWidth = -1;
    const ro = new ResizeObserver(([entry]) => {
      const rawWidth = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      const nextWidth = Math.round(rawWidth);
      if (nextWidth === lastWidth) return;
      lastWidth = nextWidth;
      document.documentElement.style.setProperty("--left-panel-width", `${nextWidth}px`);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  // Retarget the sidekick Lane whenever the active app changes so each app
  // restores the width the user chose for it.
  //
  // We intentionally skip the very first render: `sidekickInitialWidth` (used
  // as the Lane's `defaultWidth`) already reflects the initial app's stored
  // width, so running a setSize on mount would be a no-op at best and, at
  // worst, fire before the outlet has laid out.
  //
  // We rely on `sidekickResizeControlsRef` (populated by the Lane's own
  // layout effect) and `mainPanelRef` being wired before this effect runs.
  // The outlet can still be settling (main panel width momentarily 0) right
  // after a route change, so we retry across a few animation frames before
  // falling back to a ResizeObserver for the main panel. This is what makes
  // the first visit to an app reliably retarget.
  useLayoutEffect(() => {
    const previousAppId = previousSidekickAppIdRef.current;
    previousSidekickAppIdRef.current = activeApp.id;

    if (previousAppId === null) return;
    if (previousAppId === activeApp.id) return;

    let cancelled = false;
    let rafId: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let attempts = 0;
    const maxAttempts = 3;

    const applyTarget = () => {
      if (cancelled) return false;
      const mainPanelHost = mainPanelRef.current;
      const sidekickResizeControls = sidekickResizeControlsRef.current;
      if (!mainPanelHost || !sidekickResizeControls) return false;

      const mainWidth = Math.round(mainPanelHost.getBoundingClientRect().width);
      if (mainWidth <= 0) return false;

      const currentSidekickWidth = sidekickCollapsed
        ? 0
        : sidekickResizeControls.getSize();
      sidekickResizeControls.setSize(
        getSidekickTargetWidth(activeApp.id, {
          mainWidth,
          currentSidekickWidth,
        }),
      );
      return true;
    };

    const schedule = () => {
      if (cancelled) return;
      if (applyTarget()) return;
      attempts += 1;
      if (attempts < maxAttempts) {
        rafId = requestAnimationFrame(schedule);
        return;
      }
      const mainPanelHost = mainPanelRef.current;
      if (!mainPanelHost || typeof ResizeObserver === "undefined") return;
      resizeObserver = new ResizeObserver(() => {
        if (applyTarget()) {
          resizeObserver?.disconnect();
          resizeObserver = null;
        }
      });
      resizeObserver.observe(mainPanelHost);
    };

    schedule();

    return () => {
      cancelled = true;
      if (rafId != null) cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
    };
  }, [activeApp.id, sidekickCollapsed]);

  return (
    <>
      <div className={styles.desktopShell} data-desktop-mode={desktopModeActive || undefined}>
        <BackgroundLayer />
        <Topbar
          className={`titlebar-drag ${styles.topbarAlignRail} ${styles.topbarBlur}`}
          onDoubleClick={() => windowCommand("maximize")}
          icon={<OrgSelector variant="icon" />}
          title={<span className="titlebar-center" style={{ userSelect: "none" }}><img src="/AURA_logo_text_mark.png" alt="AURA" draggable={false} style={{ height: 11, display: "block", userSelect: "none", pointerEvents: "none" }} /></span>}
          actions={(
            <div className={styles.titleActions} onDoubleClick={(e) => e.stopPropagation()}>
              {features.hostRetargeting && (
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  icon={<Server size={16} />}
                  aria-label="Open host settings"
                  onClick={openHostSettings}
                />
              )}
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                icon={<PanelRight size={16} />}
                title="Toggle sidekick"
                aria-label="Toggle sidekick"
                selected={!sidekickCollapsed}
                onClick={toggleSidekick}
              />
              <WindowControls />
            </div>
          )}
        />
        <UpdateBanner />

        <div className={styles.desktopContent}>
          <div ref={leftPanelRef} className={styles.desktopSidebar}>
            <div className={styles.desktopSidebarBody}>
              <Lane
                resizable
                resizePosition="right"
                defaultWidth={200}
                maxWidth={600}
                storageKey="aura-sidebar"
                collapsible
                collapsed={isDesktop}
                animateCollapse={false}
                header={<SidebarSearchInput />}
              >
                {usesSharedDesktopLeftMenu(activeApp.id) ? (
                  <LeftMenu
                    activeAppId={activeApp.id}
                    panes={sharedDesktopLeftMenuPanes}
                    visitedAppIds={visitedAppIds}
                  />
                ) : (
                  <div className={styles.panelActive}>
                    <activeApp.LeftPanel />
                  </div>
                )}
              </Lane>
            </div>
          </div>

          <ActiveProvider>
            <div ref={mainPanelRef} className={styles.mainPanelHost}>
              <ErrorBoundary name="main">
                <MainPanel>{routeContent}</MainPanel>
              </ErrorBoundary>
            </div>
            {hasActiveSidekick && (
              <ErrorBoundary name="sidekick">
                <SidekickPortalBridge
                  headerTarget={sidekickHeaderTarget}
                  panelTarget={sidekickPanelTarget}
                />
              </ErrorBoundary>
            )}
          </ActiveProvider>
          <PersistentSidekickLane
            resizeControlsRef={sidekickResizeControlsRef}
            collapsed={sidekickHostCollapsed}
            defaultWidth={sidekickInitialWidth}
            showHeaderSlot={showSidekickHeader}
            onResizeEnd={handleSidekickResizeEnd}
            onHeaderTargetChange={handleSidekickHeaderTargetChange}
            onPanelTargetChange={handleSidekickPanelTargetChange}
          />
          {openDesktopWindowCount > 0 ? (
            <ErrorBoundary name="windows">
              <div className={styles.windowLayerHost} data-window-layer-host="true">
                <Suspense fallback={null}>
                  <DesktopWindowLayer />
                </Suspense>
              </div>
            </ErrorBoundary>
          ) : null}
        </div>
        <BottomTaskbar />
      </div>

      {hostSettingsOpen ? (
        <Suspense fallback={null}>
          <HostSettingsModal
            isOpen={hostSettingsOpen}
            onClose={() => {
              blurActiveElement();
              closeHostSettings();
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
