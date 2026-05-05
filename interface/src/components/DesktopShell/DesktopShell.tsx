import {
  Fragment,
  Suspense,
  useCallback,
  lazy,
  useRef,
  useState,
} from "react";
import { useOutlet } from "react-router-dom";
import { Lane, type LaneResizeControls } from "../Lane";
import { ResponsiveMainLane } from "../ResponsiveMainLane";
import { BottomTaskbar } from "../BottomTaskbar";
import { ErrorBoundary } from "../ErrorBoundary";
import { UpdateBanner } from "../UpdateBanner";
import { useActiveApp } from "../../hooks/use-active-app";
import { apps } from "../../apps/registry";

import { useAppUIStore } from "../../stores/app-ui-store";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { useDesktopBackgroundStore } from "../../stores/desktop-background-store";
import { useShallow } from "zustand/react/shallow";
import { LeftMenu } from "../../features/left-menu";
import {
  persistSidekickWidth,
  readStoredSidekickWidth,
} from "./desktop-shell-sidekick";
import { useDesktopWindowStore } from "../../stores/desktop-window-store";
import { BackgroundLayer } from "./BackgroundLayer";
import { DesktopTitlebar } from "./DesktopTitlebar";
import { PersistentSidekickLane } from "./PersistentSidekickLane";
import { SidebarSearchInput } from "./SidebarSearchInput";
import { SidekickPortalBridge } from "./SidekickPortalBridge";
import {
  useLeftPanelWidthCssVar,
  useSidekickWidthRetargeting,
} from "./desktop-shell-effects";
import styles from "./DesktopShell.module.css";

const DesktopWindowLayer = lazy(() =>
  import("../../apps/agents/components/AgentWindow").then((module) => ({ default: module.DesktopWindowLayer })),
);
const HostSettingsModal = lazy(() =>
  import("../HostSettingsModal").then((module) => ({ default: module.HostSettingsModal })),
);

const sharedDesktopLeftMenuPanes = apps.flatMap((app) => {
  const Pane = app.DesktopLeftMenuPane;
  return Pane ? [{ appId: app.id, Pane }] : [];
});

function usesSharedDesktopLeftMenu(appId: string): boolean {
  return sharedDesktopLeftMenuPanes.some((pane) => pane.appId === appId);
}

function blurActiveElement() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    active.blur();
  }
}

export function DesktopShell() {
  const activeApp = useActiveApp();
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
  // Callback-ref-backed state on the persistent `mainPanelHost` div. The host
  // div is now rendered above `ActiveProvider` so it stays mounted across app
  // switches — this `setState`-on-ref still gives us a stable handle that's
  // resilient to first-render timing (e.g. initial layout pass before the ref
  // has populated) and lets the sidekick retarget effect react if the host is
  // ever recreated for unrelated reasons.
  const [mainPanelEl, setMainPanelEl] = useState<HTMLDivElement | null>(null);
  const handleMainPanelRef = useCallback((node: HTMLDivElement | null) => {
    setMainPanelEl(node);
  }, []);
  const sidekickResizeControlsRef = useRef<LaneResizeControls | null>(null);
  // Tracks the app whose width is currently applied to the Lane. We only mark
  // an app as "applied" after successfully calling setSize, so if the Lane or
  // main panel isn't ready yet, a later effect run (when they come online)
  // still retries instead of skipping.
  const appliedSidekickAppIdRef = useRef<string | null>(null);
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

  useLeftPanelWidthCssVar({
    leftPanelRef,
    isDesktop,
    activeAppId: activeApp.id,
  });
  useSidekickWidthRetargeting({
    activeAppId: activeApp.id,
    sidekickCollapsed,
    mainPanelEl,
    sidekickResizeControlsRef,
    appliedSidekickAppIdRef,
  });

  return (
    <>
      <div
        className={styles.desktopShell}
        data-desktop-mode={desktopModeActive || undefined}
        data-agent-context="desktop-shell"
      >
        <BackgroundLayer />
        <DesktopTitlebar
          sidekickCollapsed={sidekickCollapsed}
          onToggleSidekick={toggleSidekick}
          onOpenHostSettings={openHostSettings}
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
                  <div
                    className={styles.panelActive}
                    data-agent-surface="left-panel"
                    data-agent-active-app-id={activeApp.id}
                    data-agent-active-app-label={activeApp.label}
                    aria-label={`${activeApp.label} navigation panel`}
                  >
                    <activeApp.LeftPanel />
                  </div>
                )}
              </Lane>
            </div>
          </div>

          <div
            ref={handleMainPanelRef}
            className={styles.mainPanelHost}
            data-agent-surface="main-panel"
            data-agent-active-app-id={activeApp.id}
            data-agent-active-app-label={activeApp.label}
            aria-label={`${activeApp.label} main panel`}
          >
            {activeApp.bareMainPanel ? (
              <ActiveProvider>
                <ErrorBoundary name="main">
                  <MainPanel>{routeContent}</MainPanel>
                </ErrorBoundary>
              </ActiveProvider>
            ) : (
              <ResponsiveMainLane>
                <ActiveProvider>
                  <ErrorBoundary name="main">
                    <MainPanel>{routeContent}</MainPanel>
                  </ErrorBoundary>
                </ActiveProvider>
              </ResponsiveMainLane>
            )}
          </div>
          {hasActiveSidekick && (
            <ErrorBoundary name="sidekick">
              <SidekickPortalBridge
                headerTarget={sidekickHeaderTarget}
                panelTarget={sidekickPanelTarget}
              />
            </ErrorBoundary>
          )}
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
