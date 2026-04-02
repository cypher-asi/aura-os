import { useCallback, type ReactNode, type ButtonHTMLAttributes } from "react";
import { useNavigate } from "react-router-dom";
import { CircleUserRound } from "lucide-react";
import { useAppStore } from "../../stores/app-store";
import { getLastSelectedAgentId } from "../../apps/agents/stores";
import { getLastProject, getLastAgent } from "../../utils/storage";
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
      {!isBar ? (
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
        <>
          <div className={styles.barGroup}>
            {primaryApps.map((app) => (
              <NavRailButton
                key={app.id}
                icon={<app.icon size={18} />}
                label={app.label}
                selected={activeApp.id === app.id}
                title={app.label}
                aria-label={app.label}
                className={styles.navBarBtn}
                onClick={() => handleAppClick(app)}
                onMouseEnter={app.onPrefetch}
                onFocus={app.onPrefetch}
              />
            ))}
          </div>
          <NavRailButton
            icon={<CircleUserRound size={18} />}
            label="Profile"
            selected={activeApp.id === "profile"}
            title="Profile"
            aria-label="Profile"
            className={styles.navBarBtn}
            onClick={() => navigate("/profile")}
          />
        </>
      )}
    </nav>
  );
}
