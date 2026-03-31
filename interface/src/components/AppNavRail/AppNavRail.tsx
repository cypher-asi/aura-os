import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@cypher-asi/zui";
import { CircleUserRound } from "lucide-react";
import { useAppStore } from "../../stores/app-store";
import { getLastSelectedAgentId } from "../../apps/agents/stores";
import { getLastProject, getLastAgent } from "../../utils/storage";
import { OrgSelector } from "../OrgSelector";
import styles from "./AppNavRail.module.css";

function resolveAppPath(app: { id: string; basePath: string }): string {
  if (app.id === "agents") {
    const lastId = getLastSelectedAgentId();
    if (lastId) return `/agents/${lastId}`;
  }
  if (app.id === "projects") {
    const projectId = getLastProject();
    if (projectId) {
      const agentInstanceId = getLastAgent(projectId);
      if (agentInstanceId) return `/projects/${projectId}/agents/${agentInstanceId}`;
      return `/projects/${projectId}/agent`;
    }
  }
  if (app.id === "tasks") {
    const projectId = getLastProject();
    if (projectId) return `/tasks/${projectId}`;
  }
  return app.basePath;
}

interface AppNavRailProps {
  layout?: "rail" | "bar";
}

export function AppNavRail({ layout = "rail" }: AppNavRailProps) {
  const apps = useAppStore((s) => s.apps);
  const activeApp = useAppStore((s) => s.activeApp);
  const navigate = useNavigate();
  const primaryApps = apps.filter((app) => app.id !== "profile" && app.id !== "desktop");
  const isBar = layout === "bar";

  const handleAppClick = useCallback(
    (app: { id: string; basePath: string }) => navigate(resolveAppPath(app)),
    [navigate],
  );

  return (
    <nav className={isBar ? styles.bar : styles.rail} aria-label="Primary navigation">
      {!isBar && (
        <div className={styles.orgIcon}>
          <OrgSelector variant="icon" />
        </div>
      )}
      <div className={isBar ? styles.barGroup : styles.appGroup}>
        {primaryApps.map((app) => (
          <Button
            key={app.id}
            variant="ghost"
            size="sm"
            icon={<app.icon size={isBar ? 18 : 28} />}
            iconOnly={!isBar}
            selected={activeApp.id === app.id}
            title={app.label}
            aria-label={app.label}
            className={isBar ? styles.barButton : styles.btn}
            onClick={() => handleAppClick(app)}
            onMouseEnter={app.onPrefetch}
            onFocus={app.onPrefetch}
          >
            {isBar ? app.label : undefined}
          </Button>
        ))}
      </div>
      <Button
        variant="ghost"
        size="sm"
        iconOnly={!isBar}
        selected={activeApp.id === "profile"}
        icon={<CircleUserRound size={isBar ? 18 : 28} />}
        title="Profile"
        aria-label="Profile"
        className={isBar ? styles.barProfileBtn : styles.profileBtn}
        onClick={() => navigate("/profile")}
      >
        {isBar ? "Profile" : undefined}
      </Button>
    </nav>
  );
}
