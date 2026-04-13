import { Fragment, useEffect, useLayoutEffect, useRef } from "react";
import { useOutlet } from "react-router-dom";
import { Topbar, Button } from "@cypher-asi/zui";
import { PanelRight, Server } from "lucide-react";
import { Lane, type LaneResizeControls } from "../Lane";
import { BottomTaskbar } from "../BottomTaskbar";
import { OrgSelector } from "../OrgSelector";
import { ErrorBoundary } from "../ErrorBoundary";
import { HostSettingsModal } from "../HostSettingsModal";
import { UpdateBanner } from "../UpdateBanner";
import { PanelSearch } from "../PanelSearch";
import { DesktopWindowLayer } from "../AgentWindow";
import { WindowControls } from "../WindowControls";
import { useAppStore } from "../../stores/app-store";
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
  DEFAULT_SIDEKICK_WIDTH,
  PROJECTS_SIDEKICK_STORAGE_KEY,
  SHARED_SIDEKICK_STORAGE_KEY,
  SIDEKICK_MAX_WIDTH,
  SIDEKICK_MIN_WIDTH,
  getProjectsSidekickTargetWidth,
} from "./desktop-shell-sidekick";
import styles from "./DesktopShell.module.css";

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

  if (mode === "none") return null;

  const style: React.CSSProperties =
    mode === "color"
      ? { backgroundColor: color }
      : { backgroundImage: `url(${imageDataUrl})`, backgroundSize: "cover", backgroundPosition: "center" };

  return <div className={styles.backgroundLayer} style={style} />;
}

function SidebarSearchInput() {
  const { query, setQuery, action } = useSidebarSearch();
  const activeApp = useAppStore((s) => s.activeApp);

  return (
    <PanelSearch
      placeholder={activeApp.searchPlaceholder ?? ""}
      value={query}
      onChange={setQuery}
      action={action}
    />
  );
}

function SidekickLane({
  resizeControlsRef,
}: {
  resizeControlsRef?: { current: LaneResizeControls | null };
}) {
  const activeApp = useAppStore((s) => s.activeApp);
  const sidekickCollapsed = useAppUIStore((s) => s.sidekickCollapsed);
  const { SidekickTaskbar } = activeApp;
  const sidekickStorageKey =
    activeApp.id === "projects" ? PROJECTS_SIDEKICK_STORAGE_KEY : SHARED_SIDEKICK_STORAGE_KEY;


  const hasAnySidekick = Boolean(activeApp.SidekickPanel);
  if (!hasAnySidekick) return null;

  return (
    <Lane
      key={sidekickStorageKey}
      resizable
      resizePosition="left"
      defaultWidth={DEFAULT_SIDEKICK_WIDTH}
      minWidth={SIDEKICK_MIN_WIDTH}
      maxWidth={SIDEKICK_MAX_WIDTH}
      storageKey={sidekickStorageKey}
      collapsible
      collapsed={sidekickCollapsed}
      resizeControlsRef={resizeControlsRef}
      header={SidekickTaskbar && <SidekickTaskbar />}
      className={styles.laneLeftBorder}
    >
      <div className={styles.sidekickPanels}>
        {activeApp.SidekickPanel && (
          <div className={styles.panelActive}>
            <activeApp.SidekickPanel />
          </div>
        )}
      </div>
    </Lane>
  );
}

export function DesktopShell() {
  const activeApp = useAppStore((s) => s.activeApp);
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
  const previousActiveAppIdRef = useRef<string | null>(null);
  const { MainPanel } = activeApp;
  const ActiveProvider = activeApp.Provider ?? Fragment;
  const isDesktop = activeApp.id === "desktop";


  useEffect(() => {
    const el = leftPanelRef.current;
    if (!el) return;
    let rafId: number | null = null;
    let lastWidth = -1;
    const ro = new ResizeObserver(([entry]) => {
      const rawWidth = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      const nextWidth = Math.round(rawWidth);
      if (nextWidth === lastWidth) return;
      lastWidth = nextWidth;
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        document.documentElement.style.setProperty("--left-panel-width", `${nextWidth}px`);
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, []);

  useLayoutEffect(() => {
    const previousActiveAppId = previousActiveAppIdRef.current;
    previousActiveAppIdRef.current = activeApp.id;

    if (activeApp.id !== "projects" || previousActiveAppId === "projects") return;

    const syncProjectsSidekickWidth = () => {
      const mainPanelHost = mainPanelRef.current;
      const sidekickResizeControls = sidekickResizeControlsRef.current;
      if (!mainPanelHost || !sidekickResizeControls) return false;

      const mainWidth = Math.round(mainPanelHost.getBoundingClientRect().width);
      if (mainWidth <= 0) return false;

      const currentSidekickWidth = sidekickCollapsed ? 0 : sidekickResizeControls.getSize();
      sidekickResizeControls.setSize(
        getProjectsSidekickTargetWidth(mainWidth, currentSidekickWidth),
      );
      return true;
    };

    if (syncProjectsSidekickWidth()) return;

    const rafId = requestAnimationFrame(() => {
      syncProjectsSidekickWidth();
    });
    return () => cancelAnimationFrame(rafId);
  }, [activeApp.id, sidekickCollapsed]);

  return (
    <>
      <div className={styles.desktopShell} data-desktop-mode={isDesktop || undefined}>
        {isDesktop && <BackgroundLayer />}
        <Topbar
          className={`titlebar-drag ${styles.topbarAlignRail} ${isDesktop ? styles.topbarBlur : ""}`}
          onDoubleClick={() => windowCommand("maximize")}
          icon={<OrgSelector variant="icon" />}
          title={<span className="titlebar-center"><img src="/AURA_logo_text_mark.png" alt="AURA" style={{ height: 11, display: "block" }} /></span>}
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
            {!isDesktop && (
              <ErrorBoundary name="sidekick">
                <SidekickLane resizeControlsRef={sidekickResizeControlsRef} />
              </ErrorBoundary>
            )}
          </ActiveProvider>
          <ErrorBoundary name="windows">
            <div className={styles.windowLayerHost} data-window-layer-host="true">
              <DesktopWindowLayer />
            </div>
          </ErrorBoundary>
        </div>
        <BottomTaskbar />
      </div>

      <HostSettingsModal
        isOpen={hostSettingsOpen}
        onClose={() => {
          blurActiveElement();
          closeHostSettings();
        }}
      />
    </>
  );
}
