import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Topbar, ButtonWindow, Input } from "@cypher-asi/zui";
import { Search } from "lucide-react";
import { Lane } from "./Lane";
import { AppNavRail } from "./AppNavRail";
import { BottomTaskbar } from "./BottomTaskbar";
import { SettingsModal } from "./SettingsModal";
import { OrgSettingsPanel } from "./OrgSettingsPanel";
import { OrgProvider } from "../context/OrgContext";
import { AppProvider, useAppContext } from "../context/AppContext";
import { SidebarSearchProvider, useSidebarSearch } from "../context/SidebarSearchContext";
import { useSidekick } from "../context/SidekickContext";
import { ProjectsProvider } from "../apps/projects/ProjectsProvider";
import { AgentAppProvider } from "../apps/agents/AgentAppProvider";
import { FeedProvider } from "../apps/feed/FeedProvider";
import { apps } from "../apps/registry";
import { windowCommand } from "../lib/windowCommand";

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

  return (
    <div style={{ position: "relative", padding: "var(--space-2)" }}>
      <Search
        size={14}
        style={{
          position: "absolute",
          left: "calc(var(--space-2) + var(--space-3, 12px))",
          top: "50%",
          transform: "translateY(-50%)",
          color: "var(--color-text-muted)",
          pointerEvents: "none",
        }}
      />
      <Input
        size="sm"
        placeholder="Search..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{
          paddingLeft: "calc(var(--space-3, 12px) + 14px + var(--space-2, 8px))",
          paddingRight: action ? "calc(var(--control-height-sm, 28px) + 2px)" : undefined,
        }}
      />
      {action && (
        <div style={{
          position: "absolute",
          right: "calc(var(--space-2) + 2px)",
          top: "50%",
          transform: "translateY(-50%)",
          display: "flex",
          alignItems: "center",
        }}>
          {action}
        </div>
      )}
    </div>
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

  const { MainPanel } = activeApp;

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

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
            <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
              <AppNavRail onOpenSettings={() => setSettingsOpen(true)} />
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
                  <AppContent />
                </LeaderboardProvider>
              </FeedProvider>
            </AgentAppProvider>
          </ProjectsProvider>
        </SidebarSearchProvider>
      </AppProvider>
    </OrgProvider>
  );
}
