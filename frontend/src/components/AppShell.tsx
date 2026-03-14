import { useState, useCallback } from "react";
import { Link, Outlet } from "react-router-dom";
import { Topbar, ButtonWindow } from "@cypher-asi/zui";
import { Lane } from "./Lane";
import { ProjectList } from "./ProjectList";
import { SidekickHeader, SidekickContent } from "./Sidekick";
import { PreviewHeader, PreviewContent } from "./Preview";
import { TaskbarLeft } from "./TaskbarLeft";
import { TaskbarMiddle } from "./TaskbarMiddle";
import { TaskbarRight } from "./TaskbarRight";
import { TerminalPanel } from "./TerminalPanel";
import { SettingsModal } from "./SettingsModal";
import { OrgSettingsPanel } from "./OrgSettingsPanel";
import { SidekickProvider, useSidekick } from "../context/SidekickContext";
import { ProjectContextProvider } from "../context/ProjectContext";
import { OrgProvider } from "../context/OrgContext";
import { windowCommand } from "../lib/windowCommand";

function AppLayout() {
  const [orgSettingsOpen, setOrgSettingsOpen] = useState(false);
  const [orgInitialSection, setOrgInitialSection] = useState<"billing" | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { previewItem } = useSidekick();

  const openOrgBilling = useCallback(() => {
    setOrgInitialSection("billing");
    setOrgSettingsOpen(true);
  }, []);

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <Topbar
          className="titlebar-drag"
          onDoubleClick={() => windowCommand("maximize")}
          icon={<img src="/aura-icon.png" alt="" className="titlebar-icon" />}
          title={<span className="titlebar-center"><Link to="/" style={{ color: "inherit", textDecoration: "none" }}>AURA</Link></span>}
          actions={
            <div className="titlebar-no-drag" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <ButtonWindow action="minimize" size="sm" onClick={() => windowCommand("minimize")} />
              <ButtonWindow action="maximize" size="sm" onClick={() => windowCommand("maximize")} />
              <ButtonWindow action="close" size="sm" onClick={() => windowCommand("close")} />
            </div>
          }
        />
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

          {/* Lane 1: AgentsList */}
          <Lane
            resizable
            resizePosition="right"
            defaultWidth={200}
            minWidth={140}
            maxWidth={300}
            storageKey="aura-sidebar"
            taskbar={
              <TaskbarLeft
                onOpenSettings={() => setSettingsOpen(true)}
                onOpenOrgSettings={() => setOrgSettingsOpen(true)}
              />
            }
          >
            <ProjectList />
          </Lane>

          {/* Lane 2: AgentChat */}
          <Lane
            flex
            style={{ borderLeft: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)" }}
            taskbar={<TaskbarMiddle />}
          >
            <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
              <Outlet />
            </main>
            <TerminalPanel />
          </Lane>

          {/* Lane 3: Sidekick */}
          <Lane
            resizable
            resizePosition="left"
            defaultWidth={320}
            minWidth={200}
            maxWidth={1200}
            storageKey="aura-sidekick"
            header={<SidekickHeader />}
            taskbar={<TaskbarRight onBuyCredits={openOrgBilling} />}
          >
            <SidekickContent />
          </Lane>

          {/* Lane 4: Preview */}
          <Lane
            resizable
            resizePosition="left"
            defaultWidth={320}
            minWidth={200}
            maxWidth={600}
            storageKey="aura-preview"
            collapsed={!previewItem}
            header={<PreviewHeader />}
            style={{ boxShadow: "-1px 0 0 0 var(--color-border)" }}
          >
            <PreviewContent />
          </Lane>

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
    <SidekickProvider>
    <OrgProvider>
    <ProjectContextProvider>
      <AppLayout />
    </ProjectContextProvider>
    </OrgProvider>
    </SidekickProvider>
  );
}
