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
import { PanelRight, Server, Settings } from "lucide-react";
import { Lane, type LaneResizeControls } from "../Lane";
import { BottomTaskbar } from "../BottomTaskbar";
import { OrgSelector } from "../OrgSelector";
import { ErrorBoundary } from "../ErrorBoundary";
import { UpdateBanner } from "../UpdateBanner";
import { PanelSearch } from "../PanelSearch";
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
  SIDEKICK_MAX_WIDTH,
  SIDEKICK_MIN_WIDTH,
  getSidekickLayoutProfile,
  getSidekickTransitionTargetWidth,
  persistSidekickWidth,
  readStoredSidekickWidth,
} from "./desktop-shell-sidekick";
import { useDesktopWindowStore } from "../../stores/desktop-window-store";
import { ChatResizeSessionContext } from "../ChatPanel/chat-resize-session-context";
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
  const activeApp = useAppStore((s) => s.activeApp);
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
  onResizeStart,
  onResizeEnd,
  onHeaderTargetChange,
  onPanelTargetChange,
}: {
  resizeControlsRef?: { current: LaneResizeControls | null };
  collapsed: boolean;
  defaultWidth: number;
  showHeaderSlot: boolean;
  onResizeStart: () => void;
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
      onResizeStart={onResizeStart}
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
  const activeApp = useAppStore((s) => s.activeApp);
  const { features } = useAuraCapabilities();
  const visitedAppIds = useAppUIStore((s) => s.visitedAppIds);
  const sidekickCollapsed = useAppUIStore((s) => s.sidekickCollapsed);
  const toggleSidekick = useAppUIStore((s) => s.toggleSidekick);
  const { hostSettingsOpen, openHostSettings, closeHostSettings, openSettings } = useUIModalStore(
    useShallow((s) => ({
      hostSettingsOpen: s.hostSettingsOpen,
      openHostSettings: s.openHostSettings,
      closeHostSettings: s.closeHostSettings,
      openSettings: s.openSettings,
    })),
  );
  const routeContent = useOutlet();
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const mainPanelRef = useRef<HTMLDivElement>(null);
  const sidekickResizeControlsRef = useRef<LaneResizeControls | null>(null);
  const previousSidekickProfileRef = useRef<"shared" | "projects" | null>(null);
  const [sidekickInitialWidth] = useState(() =>
    readStoredSidekickWidth(getSidekickLayoutProfile(activeApp.id)),
  );
  const [sidekickHeaderTarget, setSidekickHeaderTarget] =
    useState<HTMLDivElement | null>(null);
  const [sidekickPanelTarget, setSidekickPanelTarget] =
    useState<HTMLDivElement | null>(null);
  const [sidekickChatResizeSession, setSidekickChatResizeSession] = useState({
    isActive: false,
    settledAt: 0,
  });
  const openDesktopWindowCount = useDesktopWindowStore((state) => Object.keys(state.windows).length);
  const { MainPanel } = activeApp;
  const ActiveProvider = activeApp.Provider ?? Fragment;
  const isDesktop = activeApp.id === "desktop";
  const sidekickProfile = getSidekickLayoutProfile(activeApp.id);
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

  const handleSidekickResizeStart = useCallback(() => {
    setSidekickChatResizeSession((current) => (
      current.isActive ? current : { ...current, isActive: true }
    ));
  }, []);

  const handleSidekickResizeEnd = useCallback(
    (size: number) => {
      persistSidekickWidth(sidekickProfile, size);
      setSidekickChatResizeSession((current) => ({
        isActive: false,
        settledAt: current.settledAt + 1,
      }));
    },
    [sidekickProfile],
  );


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
    const previousSidekickProfile = previousSidekickProfileRef.current;
    previousSidekickProfileRef.current = sidekickProfile;

    const isCrossingProjectsBoundary =
      sidekickProfile === "projects" || previousSidekickProfile === "projects";
    if (!isCrossingProjectsBoundary) return;
    if (previousSidekickProfile === sidekickProfile) return;

    const syncProjectsSidekickWidth = () => {
      const mainPanelHost = mainPanelRef.current;
      const sidekickResizeControls = sidekickResizeControlsRef.current;
      if (!mainPanelHost || !sidekickResizeControls) return false;

      const mainWidth = Math.round(mainPanelHost.getBoundingClientRect().width);
      if (mainWidth <= 0) return false;

      const currentSidekickWidth = sidekickCollapsed
        ? 0
        : sidekickResizeControls.getSize();
      sidekickResizeControls.setSize(
        getSidekickTransitionTargetWidth(
          sidekickProfile,
          mainWidth,
          currentSidekickWidth,
        ),
      );
      return true;
    };

    if (syncProjectsSidekickWidth()) return;

    const rafId = requestAnimationFrame(() => {
      syncProjectsSidekickWidth();
    });
    return () => cancelAnimationFrame(rafId);
  }, [sidekickCollapsed, sidekickProfile]);

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
                icon={<Settings size={16} />}
                aria-label="Open app settings"
                title="Open app settings"
                onClick={openSettings}
              />
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
                <ChatResizeSessionContext.Provider value={sidekickChatResizeSession}>
                  <SidekickPortalBridge
                    headerTarget={sidekickHeaderTarget}
                    panelTarget={sidekickPanelTarget}
                  />
                </ChatResizeSessionContext.Provider>
              </ErrorBoundary>
            )}
          </ActiveProvider>
          <PersistentSidekickLane
            resizeControlsRef={sidekickResizeControlsRef}
            collapsed={sidekickHostCollapsed}
            defaultWidth={sidekickInitialWidth}
            showHeaderSlot={showSidekickHeader}
            onResizeStart={handleSidekickResizeStart}
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
