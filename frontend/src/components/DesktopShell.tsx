import { useState, useEffect, useRef } from "react";
import { Link, useOutlet } from "react-router-dom";
import { Topbar, Button } from "@cypher-asi/zui";
import { Server } from "lucide-react";
import { Lane } from "./Lane";
import { AppNavRail } from "./AppNavRail";
import { BottomTaskbar } from "./BottomTaskbar";
import { ErrorBoundary } from "./ErrorBoundary";
import { HostSettingsModal } from "./HostSettingsModal";
import { UpdateBanner } from "./UpdateBanner";
import { PanelSearch } from "./PanelSearch";
import { WindowControls } from "./WindowControls";
import { useAppStore } from "../stores/app-store";
import { useSidebarSearch } from "../context/SidebarSearchContext";
import { useSidekick } from "../stores/sidekick-store";
import { useAppUIStore } from "../stores/app-ui-store";
import { useAuraCapabilities } from "../hooks/use-aura-capabilities";
import { apps } from "../apps/registry";
import { windowCommand } from "../lib/windowCommand";
import { dbg } from "../lib/dbg";
import styles from "./AppShell.module.css";

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
      placeholder={activeApp.searchPlaceholder ?? "Search..."}
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

  // #region agent log
  dbg('SidekickLane:render', 'SidekickLane render', {activeApp:activeApp.id,visitedCount:visitedAppIds.size});
  // #endregion

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
      style={{ boxShadow: "-1px 0 0 0 var(--color-border)" }}
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
      style={{ boxShadow: "-1px 0 0 0 var(--color-border)" }}
    >
      {PreviewPanel && <PreviewPanel />}
    </Lane>
  );
}

export function DesktopShell({
  onOpenOrgSettings,
  onBuyCredits,
}: {
  onOpenOrgSettings: () => void;
  onBuyCredits: () => void;
}) {
  const activeApp = useAppStore((s) => s.activeApp);
  const { features } = useAuraCapabilities();
  const visitedAppIds = useAppUIStore((s) => s.visitedAppIds);
  const routeContent = useOutlet();
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const [hostSettingsOpen, setHostSettingsOpen] = useState(false);
  const { MainPanel, PreviewPanel } = activeApp;

  // #region agent log
  const prevAppIdRef = useRef(activeApp.id);
  const renderT = performance.now();
  const appChanged = prevAppIdRef.current !== activeApp.id;
  if (appChanged) {
    fetch('http://127.0.0.1:7888/ingest/89d88b3b-9aca-4e16-8ac5-ebaceae56093',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'07b16f'},body:JSON.stringify({sessionId:'07b16f',location:'DesktopShell.tsx:render',message:'DesktopShell render NEW APP',data:{from:prevAppIdRef.current,to:activeApp.id,renderT},timestamp:Date.now(),hypothesisId:'C'})}).catch(()=>{});
    prevAppIdRef.current = activeApp.id;
  }
  useEffect(() => {
    if (appChanged) {
      const commitT = performance.now();
      fetch('http://127.0.0.1:7888/ingest/89d88b3b-9aca-4e16-8ac5-ebaceae56093',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'07b16f'},body:JSON.stringify({sessionId:'07b16f',location:'DesktopShell.tsx:commit',message:'DesktopShell commit done',data:{app:activeApp.id,renderToCommitMs:commitT-renderT},timestamp:Date.now(),hypothesisId:'C'})}).catch(()=>{});
    }
  });
  // #endregion

  useEffect(() => {
    const el = leftPanelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      document.documentElement.style.setProperty("--left-panel-width", `${w}px`);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <>
      <div className={styles.desktopShell}>
        <Topbar
          className="titlebar-drag"
          onDoubleClick={() => windowCommand("maximize")}
          icon={<img src="/aura-icon.png" alt="" className="titlebar-icon" />}
          title={<span className="titlebar-center"><Link to="/projects" style={{ color: "inherit", textDecoration: "none" }}>AURA</Link></span>}
          actions={(
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              {features.hostRetargeting && (
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  icon={<Server size={16} />}
                  aria-label="Open host settings"
                  onClick={() => setHostSettingsOpen(true)}
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
            <BottomTaskbar
              onOpenOrgSettings={onOpenOrgSettings}
              onBuyCredits={onBuyCredits}
            />
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
          setHostSettingsOpen(false);
        }}
      />
    </>
  );
}
