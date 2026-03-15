import { useNavigate } from "react-router-dom";
import { Button } from "@cypher-asi/zui";
import { CircleUserRound } from "lucide-react";
import { useAppContext } from "../context/AppContext";
import styles from "./AppNavRail.module.css";

interface Props {
  onOpenSettings?: () => void;
}

export function AppNavRail({ onOpenSettings }: Props) {
  const { apps, activeApp } = useAppContext();
  const navigate = useNavigate();

  return (
    <nav className={styles.rail}>
      {apps.map((app) => (
        <Button
          key={app.id}
          variant="ghost"
          size="sm"
          iconOnly
          icon={<app.icon size={28} />}
          title={app.label}
          aria-label={app.label}
          className={activeApp.id === app.id ? styles.active : styles.btn}
          style={activeApp.id === app.id ? { color: "#ffffff" } : undefined}
          onClick={() => navigate(app.basePath)}
        />
      ))}
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon={<CircleUserRound size={28} />}
        title="Profile"
        aria-label="Profile"
        className={styles.profileBtn}
        onClick={onOpenSettings}
      />
    </nav>
  );
}
