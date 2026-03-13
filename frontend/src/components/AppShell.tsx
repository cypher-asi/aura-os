import { Link, Outlet } from "react-router-dom";
import { Topbar, Sidebar, Button, ButtonWindow } from "@cypher-asi/zui";
import { Settings } from "lucide-react";
import { ProjectList } from "./ProjectList";
import { UserProfile } from "./UserProfile";
import { Sidekick } from "./Sidekick";
import { SidekickProvider } from "../context/SidekickContext";
import { ProjectContextProvider } from "../context/ProjectContext";
import { windowCommand } from "../lib/windowCommand";

export function AppShell() {
  return (
    <SidekickProvider>
    <ProjectContextProvider>
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <Topbar
          className="titlebar-drag"
          onDoubleClick={() => windowCommand("maximize")}
          title={<Link to="/" style={{ color: "inherit", textDecoration: "none" }}>AURA</Link>}
          actions={
            <div className="titlebar-no-drag" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <Link to="/settings">
                <Button variant="ghost" size="sm" icon={<Settings size={16} />} iconOnly aria-label="Settings" />
              </Link>
              <ButtonWindow action="minimize" size="sm" onClick={() => windowCommand("minimize")} />
              <ButtonWindow action="maximize" size="sm" onClick={() => windowCommand("maximize")} />
              <ButtonWindow action="close" size="sm" onClick={() => windowCommand("close")} />
            </div>
          }
        />
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <Sidebar className="nav-sidebar" resizable defaultWidth={240} minWidth={180} maxWidth={360} storageKey="aura-sidebar" footer={<UserProfile />}>
            <ProjectList />
          </Sidebar>
          <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
              <Outlet />
            </div>
          </main>
          <Sidekick />
        </div>
      </div>
    </ProjectContextProvider>
    </SidekickProvider>
  );
}
