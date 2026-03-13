import { Link, Outlet } from "react-router-dom";
import { Topbar, Sidebar, Button } from "@cypher-asi/zui";
import { Settings } from "lucide-react";
import { ProjectList } from "./ProjectList";

export function AppShell() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Topbar
        title={<Link to="/" style={{ color: "inherit", textDecoration: "none" }}>Aura</Link>}
        actions={
          <Link to="/settings">
            <Button variant="ghost" size="sm" icon={<Settings size={16} />} iconOnly aria-label="Settings" />
          </Link>
        }
      />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <Sidebar resizable defaultWidth={240} minWidth={180} maxWidth={360} storageKey="aura-sidebar">
          <ProjectList />
        </Sidebar>
        <main style={{ flex: 1, overflow: "auto", padding: "var(--space-6)" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
