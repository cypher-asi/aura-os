import { Fragment, useEffect, useRef } from "react";
import { useNavigate, useOutlet } from "react-router-dom";
import { Topbar, Button } from "@cypher-asi/zui";
import { CircleUserRound, PanelRight, Server } from "lucide-react";
import { Lane } from "../Lane";
import { AppNavRail } from "../AppNavRail";
import { BottomTaskbar } from "../BottomTaskbar";
import { OrgSelector } from "../OrgSelector";
import { ErrorBoundary } from "../ErrorBoundary";
import { HostSettingsModal } from "../HostSettingsModal";
import { UpdateBanner } from "../UpdateBanner";
import { PanelSearch } from "../PanelSearch";
import { TaskOutputPanel } from "../TaskOutputPanel";
import { WindowControls } from "../WindowControls";
import { useAppStore } from "../../stores/app-store";
import { useSidebarSearch } from "../../hooks/use-sidebar-search";

import { useAppUIStore } from "../../stores/app-ui-store";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { useDesktopBackgroundStore } from "../../stores/desktop-background-store";
import { useShallow } from "zustand/react/shallow";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { apps } from "../../apps/registry";
import { windowCommand } from "../../lib/windowCommand";
import styles from "../AppShell/AppShell.module.css";

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

function SidekickLane() {
  const activeApp = useAppStore((s) => s.activeApp);
  const visitedAppIds = useAppUIStore((s) => s.visitedAppIds);
  const sidekickCollapsed = useAppUIStore((s) => s.sidekickCollapsed);
  const { SidekickTaskbar } = activeApp;


  const hasAnySidekick = apps.some(
    (app) => app.SidekickPanel && (visitedAppIds.has(app.id) || app.id === activeApp.id),
  );
  if (!hasAnySidekick) return null;

  return (
    <Lane
      resizable
      resizePosition="left"
      defaultWidth={320}
      minWidth={200}
      maxWidth={1200}
      storageKey="aura-sidekick-v2"
      collapsible
      collapsed={sidekickCollapsed}
      header={SidekickTaskbar && <SidekickTaskbar />}
      className={styles.laneLeftBorder}
    >
      <div className={styles.sidekickContentWrapper}>
        <div className={styles.sidekickPanels}>
          {apps.map((app) => {
            if (!app.SidekickPanel || !visitedAppIds.has(app.id)) return null;
            return (
              <div
                key={app.id}
                className={app.id === activeApp.id ? styles.panelActive : styles.panelHidden}
              >
                <app.SidekickPanel />
              </div>
            );
          })}
        </div>
        <TaskOutputPanel />
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
  const navigate = useNavigate();
  const { hostSettingsOpen, openHostSettings, closeHostSettings } = useUIModalStore(
    useShallow((s) => ({
      hostSettingsOpen: s.hostSettingsOpen,
      openHostSettings: s.openHostSettings,
      closeHostSettings: s.closeHostSettings,
    })),
  );
  const routeContent = useOutlet();
  const leftPanelRef = useRef<HTMLDivElement>(null);
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
                selected={activeApp.id === "profile"}
                icon={<CircleUserRound size={16} />}
                title="Profile"
                aria-label="Profile"
                onClick={() => navigate("/profile")}
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
              <div className={styles.navRailWrapper}>
                <AppNavRail />
              </div>
              <Lane
                resizable
                resizePosition="right"
                defaultWidth={200}
                maxWidth={600}
                storageKey="aura-sidebar"
                collapsible
                collapsed={isDesktop}
                header={<SidebarSearchInput />}
              >
                {apps.map((app) => {
                  if (!visitedAppIds.has(app.id) && app.id !== activeApp.id) return null;
                  return (
                    <div
                      key={app.id}
                      className={app.id === activeApp.id ? styles.panelActive : styles.panelHidden}
                    >
                      <app.LeftPanel />
                    </div>
                  );
                })}
              </Lane>
            </div>
          </div>

          <ActiveProvider>
            <ErrorBoundary name="main">
              <MainPanel>{routeContent}</MainPanel>
            </ErrorBoundary>
            {!isDesktop && (
              <ErrorBoundary name="sidekick">
                <SidekickLane />
              </ErrorBoundary>
            )}
          </ActiveProvider>
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
