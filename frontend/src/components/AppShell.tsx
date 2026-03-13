import { Link, Outlet } from "react-router-dom";
import { Topbar, Sidebar, Button, ButtonWindow } from "@cypher-asi/zui";
import { Settings } from "lucide-react";
import { ProjectList } from "./ProjectList";
import { Sidekick } from "./Sidekick";
import { SidekickProvider } from "../context/SidekickContext";
import { windowCommand } from "../lib/windowCommand";

export function AppShell() {
  return (
    <SidekickProvider>
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
          <Sidebar resizable defaultWidth={240} minWidth={180} maxWidth={360} storageKey="aura-sidebar">
            <ProjectList />
          </Sidebar>
          <main style={{ flex: 1, overflow: "auto", padding: "var(--space-6)" }}>
            <Outlet />
          </main>
          <Sidekick />
        </div>
      </div>
    </SidekickProvider>
  );
}
