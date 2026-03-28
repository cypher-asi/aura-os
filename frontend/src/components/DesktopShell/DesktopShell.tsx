import { useEffect, useRef } from "react";
import { useOutlet } from "react-router-dom";
import { Topbar, Button } from "@cypher-asi/zui";
import { Server } from "lucide-react";
import { Lane } from "../Lane";
import { AppNavRail } from "../AppNavRail";
import { BottomTaskbar } from "../BottomTaskbar";
import { ErrorBoundary } from "../ErrorBoundary";
import { HostSettingsModal } from "../HostSettingsModal";
import { UpdateBanner } from "../UpdateBanner";
import { PanelSearch } from "../PanelSearch";
import { WindowControls } from "../WindowControls";
import { useAppStore } from "../../stores/app-store";
import { useSidebarSearch } from "../../context/SidebarSearchContext";
import { useSidekick } from "../../stores/sidekick-store";
import { useAppUIStore } from "../../stores/app-ui-store";
import { useUIModalStore } from "../../stores/ui-modal-store";
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
  const { SidekickTaskbar, SidekickHeader: SidekickHeaderComp } = activeApp;


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
      header={SidekickTaskbar && <SidekickTaskbar />}
      taskbar={SidekickHeaderComp && <SidekickHeaderComp />}
      className={styles.laneLeftBorder}
    >
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
    </Lane>
  );
}

function PreviewLane() {
  const activeApp = useAppStore((s) => s.activeApp);
  const { PreviewPanel, PreviewHeader: PreviewHeaderComp } = activeApp;
  const { previewItem } = useSidekick();

  return (
    <Lane
      resizable
      resizePosition="left"
      defaultWidth={320}
      maxWidth={1200}
      storageKey="aura-preview"
      collapsible
      collapsed={!previewItem}
      header={PreviewHeaderComp && <PreviewHeaderComp />}
      className={styles.laneLeftBorder}
    >
      {PreviewPanel && <PreviewPanel />}
    </Lane>
  );
}

export function DesktopShell() {
  const activeApp = useAppStore((s) => s.activeApp);
  const { features } = useAuraCapabilities();
  const visitedAppIds = useAppUIStore((s) => s.visitedAppIds);
  const { hostSettingsOpen, openHostSettings, closeHostSettings } = useUIModalStore();
  const routeContent = useOutlet();
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const { MainPanel, PreviewPanel } = activeApp;


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
      <div className={styles.desktopShell}>
        <Topbar
          className="titlebar-drag"
          onDoubleClick={() => windowCommand("maximize")}
          icon={<img src="/aura-icon.png" alt="" className="titlebar-icon" />}
          title={<span className="titlebar-center"><img src="/AURA_logo_text_mark.png" alt="AURA" style={{ height: 11, display: "block" }} /></span>}
          actions={(
            <div className={styles.titleActions}>
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
              <WindowControls />
            </div>
          )}
        />
        <UpdateBanner />

        <div className={styles.desktopContent}>
          <div ref={leftPanelRef} className={styles.desktopSidebar}>
            <div className={styles.desktopSidebarBody}>
              <AppNavRail />
              <Lane
                resizable
                resizePosition="right"
                defaultWidth={200}
                maxWidth={600}
                storageKey="aura-sidebar"
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
            <BottomTaskbar />
          </div>

          <ErrorBoundary name="main">
            <MainPanel>{routeContent}</MainPanel>
          </ErrorBoundary>
          <ErrorBoundary name="sidekick">
            <SidekickLane />
          </ErrorBoundary>
          {PreviewPanel && (
            <ErrorBoundary name="preview">
              <PreviewLane />
            </ErrorBoundary>
          )}
        </div>
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
