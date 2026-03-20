import { useNavigate } from "react-router-dom";
import { Button } from "@cypher-asi/zui";
import { CircleUserRound } from "lucide-react";
import { useAppContext } from "../context/AppContext";
import styles from "./AppNavRail.module.css";

interface AppNavRailProps {
  layout?: "rail" | "bar";
}

export function AppNavRail({ layout = "rail" }: AppNavRailProps) {
  const { apps, activeApp } = useAppContext();
  const navigate = useNavigate();
  const primaryApps = apps.filter((app) => app.id !== "profile");
  const isBar = layout === "bar";

  return (
    <nav className={isBar ? styles.bar : styles.rail} aria-label="Primary navigation">
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
            onClick={() => navigate(app.basePath)}
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
