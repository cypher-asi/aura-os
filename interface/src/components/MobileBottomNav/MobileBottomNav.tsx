import { Brain, CheckSquare, BarChart3 } from "lucide-react";
import styles from "../AppShell/AppShell.module.css";

export type MobileNavId = "agent" | "tasks" | "stats";

const MOBILE_NAV_ITEMS: Array<{ id: MobileNavId; label: string; icon: typeof Brain }> = [
  { id: "agent", label: "Agent", icon: Brain },
  { id: "tasks", label: "Execution", icon: CheckSquare },
  { id: "stats", label: "Stats", icon: BarChart3 },
];

export function MobileBottomNav({
  activeId,
  onNavigate,
}: {
  activeId: MobileNavId | null;
  onNavigate: (id: MobileNavId) => void;
}) {
  return (
    <nav
      className={styles.mobileNavBar}
      aria-label="Primary mobile navigation"
      style={{ gridTemplateColumns: `repeat(${MOBILE_NAV_ITEMS.length}, minmax(0, 1fr))` }}
    >
      {MOBILE_NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          className={styles.mobileNavButton}
          data-active={activeId === item.id ? "true" : "false"}
          onClick={() => onNavigate(item.id)}
          type="button"
          aria-pressed={activeId === item.id}
        >
          <item.icon size={18} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
