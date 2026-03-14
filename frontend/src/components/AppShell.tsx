import { useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { Topbar, Sidebar, ButtonWindow } from "@cypher-asi/zui";
import { ProjectList } from "./ProjectList";
import { Sidekick } from "./Sidekick";
import { Preview } from "./Preview";
import { TaskbarLeft } from "./TaskbarLeft";
import { TaskbarRight } from "./TaskbarRight";
import { TerminalPanel } from "./TerminalPanel";
import { SettingsModal } from "./SettingsModal";
import { OrgSettingsPanel } from "./OrgSettingsPanel";
import { SidekickProvider } from "../context/SidekickContext";
import { ProjectContextProvider } from "../context/ProjectContext";
import { OrgProvider } from "../context/OrgContext";
import { windowCommand } from "../lib/windowCommand";

export function AppShell() {
  const [orgSettingsOpen, setOrgSettingsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <SidekickProvider>
    <OrgProvider>
    <ProjectContextProvider>
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
          {/* Left column: sidebar + taskbar left */}
          <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
              <Sidebar
                className="nav-sidebar"
                resizable
                defaultWidth={200}
                minWidth={140}
                maxWidth={300}
                storageKey="aura-sidebar"
              >
                <ProjectList />
              </Sidebar>
            </div>
            <TaskbarLeft
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenOrgSettings={() => setOrgSettingsOpen(true)}
            />
          </div>

          {/* Middle column: main content + terminal (taskbar middle) */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
              <Outlet />
            </main>
            <TerminalPanel />
          </div>

          {/* Right column: sidekick/preview + taskbar right */}
          <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", borderLeft: "1px solid var(--color-border)" }}>
            <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
              <Sidekick />
              <Preview />
            </div>
            <TaskbarRight />
          </div>
        </div>
      </div>
      <OrgSettingsPanel isOpen={orgSettingsOpen} onClose={() => setOrgSettingsOpen(false)} />
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </ProjectContextProvider>
    </OrgProvider>
    </SidekickProvider>
  );
}
