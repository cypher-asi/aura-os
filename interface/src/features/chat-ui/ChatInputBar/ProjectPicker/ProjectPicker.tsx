import { memo, useEffect, useRef, useState } from "react";
import { ChevronDown, FolderOpen } from "lucide-react";
import styles from "./ProjectPicker.module.css";

export interface ProjectPickerOption {
  project_id: string;
  name: string;
}

export interface ProjectPickerProps {
  projects: readonly ProjectPickerOption[];
  selectedProjectId?: string;
  onProjectChange?: (projectId: string) => void;
}

/**
 * Info-bar project chip + dropdown. Hidden entirely when there is
 * nothing to scope to AND no projects to switch into (e.g. the public
 * logged-out chat surface); inert (no dropdown affordance) when a
 * selection exists but switching isn't wired.
 */
export const ProjectPicker = memo(function ProjectPicker({
  projects,
  selectedProjectId,
  onProjectChange,
}: ProjectPickerProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  const selectedProject = projects.find(
    (p) => p.project_id === selectedProjectId,
  );
  if (projects.length === 0 && selectedProject == null) return null;

  const isInteractive = projects.length > 0 && onProjectChange != null;
  const selectedProjectName = selectedProject?.name;

  return (
    <div className={styles.projectMenuWrap} ref={menuRef}>
      <button
        type="button"
        className={styles.projectButton}
        title={selectedProjectName ?? "General"}
        onClick={isInteractive ? () => setMenuOpen((v) => !v) : undefined}
        style={isInteractive ? undefined : { cursor: "default" }}
      >
        <FolderOpen size={10} />
        <span className={styles.projectButtonLabel}>
          {selectedProjectName ?? "General"}
        </span>
        {isInteractive && <ChevronDown size={10} />}
      </button>
      {menuOpen && isInteractive && (
        <div className={styles.projectMenu}>
          {projects.map((p) => (
            <button
              key={p.project_id}
              type="button"
              className={`${styles.projectMenuItem} ${p.project_id === selectedProjectId ? styles.projectMenuItemActive : ""}`}
              onClick={() => {
                onProjectChange(p.project_id);
                setMenuOpen(false);
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
