import { useCallback, type ReactNode, type ButtonHTMLAttributes } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../stores/app-store";
import { getLastSelectedAgentId } from "../../apps/agents/stores";
import { getLastProject, getLastAgent } from "../../utils/storage";
import { LAST_PROCESS_ID_KEY } from "../../apps/process/stores/process-store";
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
  if (app.id === "process") {
    const lastId = localStorage.getItem(LAST_PROCESS_ID_KEY);
    if (lastId) return `/process/${lastId}`;
  }
  return app.basePath;
}

interface NavRailButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label?: string;
  selected?: boolean;
}

function NavRailButton({ icon, label, selected, className, ...props }: NavRailButtonProps) {
  const cls = [
    styles.navBtn,
    selected ? styles.navBtnSelected : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="button" className={cls} {...props}>
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}

interface AppNavRailProps {
  layout?: "rail" | "bar" | "taskbar";
}

export function AppNavRail({ layout = "rail" }: AppNavRailProps) {
  const apps = useAppStore((s) => s.apps);
  const activeApp = useAppStore((s) => s.activeApp);
  const navigate = useNavigate();
  const primaryApps = apps.filter((app) => app.id !== "desktop");
  const isRail = layout === "rail";
  const isBar = layout === "bar";
  const isTaskbar = layout === "taskbar";

  const handleAppClick = useCallback(
    (app: { id: string; basePath: string }) => navigate(resolveAppPath(app)),
    [navigate],
  );

  return (
    <nav
      className={isRail ? styles.rail : isBar ? styles.bar : styles.taskbar}
      aria-label="Primary navigation"
    >
      {isRail ? (
        <>
          <div className={styles.spacer} />
          <div className={styles.floatingGroupMiddle}>
            <div className={styles.appGroup}>
              {primaryApps.map((app) => (
                <NavRailButton
                  key={app.id}
                  icon={<app.icon size={18} />}
                  selected={activeApp.id === app.id}
                  title={app.label}
                  aria-label={app.label}
                  onClick={() => handleAppClick(app)}
                  onMouseEnter={app.onPrefetch}
                  onFocus={app.onPrefetch}
                />
              ))}
            </div>
          </div>
          <div className={styles.spacer} />
        </>
      ) : (
        <div className={isBar ? styles.barGroup : styles.taskbarGroup}>
          {primaryApps.map((app) => (
            <NavRailButton
              key={app.id}
              icon={<app.icon size={isBar ? 17 : 18} />}
              label={isBar ? app.label : undefined}
              selected={activeApp.id === app.id}
              title={app.label}
              aria-label={app.label}
              className={isBar ? styles.navBarBtn : isTaskbar ? styles.taskbarBtn : undefined}
              onClick={() => handleAppClick(app)}
              onMouseEnter={app.onPrefetch}
              onFocus={app.onPrefetch}
            />
          ))}
        </div>
      )}
    </nav>
  );
}
