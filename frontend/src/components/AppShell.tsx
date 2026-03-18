import { useState, useCallback, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Topbar, ButtonWindow } from "@cypher-asi/zui";
import { Lane } from "./Lane";
import { AppNavRail } from "./AppNavRail";
import { BottomTaskbar } from "./BottomTaskbar";
import { SettingsModal } from "./SettingsModal";
import { UpdateBanner } from "./UpdateBanner";
import { OrgSettingsPanel } from "./OrgSettingsPanel";
import { PanelSearch } from "./PanelSearch";
import { OrgProvider } from "../context/OrgContext";
import { AppProvider, useAppContext } from "../context/AppContext";
import { SidebarSearchProvider, useSidebarSearch } from "../context/SidebarSearchContext";
import { useSidekick } from "../context/SidekickContext";
import { ProjectsProvider } from "../apps/projects/ProjectsProvider";
import { AgentAppProvider } from "../apps/agents/AgentAppProvider";
import { FeedProvider } from "../apps/feed/FeedProvider";
import { LeaderboardProvider } from "../apps/leaderboard/LeaderboardContext";
import { ProfileProvider } from "../apps/profile/ProfileProvider";
import { apps } from "../apps/registry";
import { windowCommand } from "../lib/windowCommand";
import { INSUFFICIENT_CREDITS_EVENT } from "../api/client";

function SidekickLane() {
  const { activeApp } = useAppContext();
  const { SidekickPanel, SidekickTaskbar, SidekickHeader: SidekickHeaderComp } = activeApp;

  if (!SidekickPanel) return null;

  return (
    <Lane
      resizable
      resizePosition="left"
      defaultWidth={320}
      maxWidth={1200}
      storageKey="aura-sidekick"
      header={SidekickTaskbar && <SidekickTaskbar />}
      taskbar={SidekickHeaderComp && <SidekickHeaderComp />}
      style={{ boxShadow: "-1px 0 0 0 var(--color-border)" }}
    >
      <SidekickPanel />
    </Lane>
  );
}

function PreviewLane() {
  const { activeApp } = useAppContext();
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

function SidebarSearchInput() {
  const { query, setQuery, action } = useSidebarSearch();
  const { activeApp } = useAppContext();

  return (
    <PanelSearch
      placeholder={activeApp.searchPlaceholder ?? "Search..."}
      value={query}
      onChange={setQuery}
      action={action}
    />
  );
}

function AppContent() {
  const { activeApp } = useAppContext();
  const [orgSettingsOpen, setOrgSettingsOpen] = useState(false);
  const [orgInitialSection, setOrgInitialSection] = useState<"billing" | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const openOrgBilling = useCallback(() => {
    setOrgInitialSection("billing");
    setOrgSettingsOpen(true);
  }, []);

  useEffect(() => {
    const handler = () => openOrgBilling();
    window.addEventListener(INSUFFICIENT_CREDITS_EVENT, handler);
    return () => window.removeEventListener(INSUFFICIENT_CREDITS_EVENT, handler);
  }, [openOrgBilling]);

  const { MainPanel } = activeApp;

  const leftPanelRef = useRef<HTMLDivElement>(null);

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
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <Topbar
          className="titlebar-drag"
          onDoubleClick={() => windowCommand("maximize")}
          icon={<img src="/aura-icon.png" alt="" className="titlebar-icon" />}
          title={<span className="titlebar-center"><Link to="/projects" style={{ color: "inherit", textDecoration: "none" }}>AURA</Link></span>}
          actions={
            <div className="titlebar-no-drag" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <ButtonWindow action="minimize" size="sm" onClick={() => windowCommand("minimize")} />
              <ButtonWindow action="maximize" size="sm" onClick={() => windowCommand("maximize")} />
              <ButtonWindow action="close" size="sm" onClick={() => windowCommand("close")} />
            </div>
          }
        />

        <UpdateBanner />

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div ref={leftPanelRef} style={{ display: "grid", gridTemplateRows: "1fr auto", gridTemplateColumns: "min-content", flexShrink: 0 }}>
            <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
              <AppNavRail />
              <Lane
                resizable
                resizePosition="right"
                defaultWidth={200}
                maxWidth={600}
                storageKey="aura-sidebar"
                header={<SidebarSearchInput />}
              >
                {apps.map((app) => (
                  <div
                    key={app.id}
                    style={{ display: app.id === activeApp.id ? "contents" : "none" }}
                  >
                    <app.LeftPanel />
                  </div>
                ))}
              </Lane>
            </div>
            <BottomTaskbar
              onOpenOrgSettings={() => setOrgSettingsOpen(true)}
              onBuyCredits={openOrgBilling}
            />
          </div>

          <MainPanel />
          <SidekickLane />
          {activeApp.PreviewPanel && <PreviewLane />}
        </div>
      </div>

      <OrgSettingsPanel
        isOpen={orgSettingsOpen}
        onClose={() => { setOrgSettingsOpen(false); setOrgInitialSection(undefined); }}
        initialSection={orgInitialSection}
      />
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

export function AppShell() {
  return (
    <OrgProvider>
      <AppProvider apps={apps}>
        <SidebarSearchProvider>
          <ProjectsProvider>
            <AgentAppProvider>
              <FeedProvider>
                <LeaderboardProvider>
                  <ProfileProvider>
                    <AppContent />
                  </ProfileProvider>
                </LeaderboardProvider>
              </FeedProvider>
            </AgentAppProvider>
          </ProjectsProvider>
        </SidebarSearchProvider>
      </AppProvider>
    </OrgProvider>
  );
}
