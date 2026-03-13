import { useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { Topbar, Sidebar, ButtonWindow } from "@cypher-asi/zui";
import { ProjectList } from "./ProjectList";
import { UserProfile } from "./UserProfile";
import { OrgSelector } from "./OrgSelector";
import { OrgSettingsPanel } from "./OrgSettingsPanel";
import { Sidekick } from "./Sidekick";
import { Preview } from "./Preview";
import { SidekickProvider } from "../context/SidekickContext";
import { ProjectContextProvider } from "../context/ProjectContext";
import { OrgProvider } from "../context/OrgContext";
import { windowCommand } from "../lib/windowCommand";

function SidebarFooter() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <>
      <OrgSelector onOpenSettings={() => setSettingsOpen(true)} />
      <UserProfile />
      <OrgSettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

export function AppShell() {
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
          <Sidebar className="nav-sidebar" resizable defaultWidth={200} minWidth={140} maxWidth={300} storageKey="aura-sidebar" footer={<SidebarFooter />}>
            <ProjectList />
          </Sidebar>
          <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
              <Outlet />
            </div>
          </main>
          <Sidekick />
          <Preview />
        </div>
      </div>
    </ProjectContextProvider>
    </OrgProvider>
    </SidekickProvider>
  );
}
