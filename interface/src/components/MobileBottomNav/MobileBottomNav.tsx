import {
  BarChart3,
  Brain,
  Cpu,
  FolderClosed,
  ListTodo,
  MoreHorizontal,
  Play,
} from "lucide-react";
import styles from "../MobileShell/MobileShell.module.css";

export type MobileNavId = "agent" | "files" | "tasks" | "execution" | "more";
export type MobileMoreNavId = "process" | "stats";

const MOBILE_NAV_ITEMS: Array<{ id: MobileNavId; label: string; icon: typeof Brain }> = [
  { id: "agent", label: "Agents", icon: Brain },
  { id: "files", label: "Files", icon: FolderClosed },
  { id: "tasks", label: "Tasks", icon: ListTodo },
  { id: "execution", label: "Run", icon: Play },
  { id: "more", label: "More", icon: MoreHorizontal },
];

export const MOBILE_MORE_NAV_ITEMS: Array<{
  id: MobileMoreNavId;
  label: string;
  icon: typeof Brain;
}> = [
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
