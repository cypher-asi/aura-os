import { Brain, CheckSquare, ListTodo, BarChart3, Cpu, FolderClosed } from "lucide-react";
import styles from "../MobileShell/MobileShell.module.css";

export type MobileNavId = "agent" | "tasks" | "execution" | "files" | "process" | "stats";

const MOBILE_NAV_ITEMS: Array<{ id: MobileNavId; label: string; icon: typeof Brain }> = [
  { id: "agent", label: "Agents", icon: Brain },
  { id: "tasks", label: "Tasks", icon: ListTodo },
  { id: "execution", label: "Execution", icon: CheckSquare },
  { id: "files", label: "Files", icon: FolderClosed },
  { id: "process", label: "Process", icon: Cpu },
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
      aria-label="Project sections"
    >
      {MOBILE_NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          className={styles.mobileNavButton}
          data-active={activeId === item.id ? "true" : "false"}
          data-nav-id={item.id}
          onClick={() => onNavigate(item.id)}
          type="button"
          aria-pressed={activeId === item.id}
        >
          <item.icon size={20} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
