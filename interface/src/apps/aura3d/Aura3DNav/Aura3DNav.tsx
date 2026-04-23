import { useEffect, useMemo, useRef, useState } from "react";
import { Box, ImageIcon, ChevronDown } from "lucide-react";
import { useAura3DStore } from "../../../stores/aura3d-store";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { LeftMenuTree, buildLeftMenuEntries } from "../../../features/left-menu";
import { EmptyState } from "../../../components/EmptyState";
import styles from "./Aura3DNav.module.css";

export function Aura3DNav() {
  const projects = useProjectsListStore((s) => s.projects);
  const selectedProjectId = useAura3DStore((s) => s.selectedProjectId);
  const setSelectedProjectId = useAura3DStore((s) => s.setSelectedProjectId);
  const images = useAura3DStore((s) => s.images);
  const selectedImageId = useAura3DStore((s) => s.selectedImageId);
  const selectImage = useAura3DStore((s) => s.selectImage);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(["images"]));

  // Auto-select first project if none selected
  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      setSelectedProjectId(projects[0].project_id);
    }
  }, [selectedProjectId, projects, setSelectedProjectId]);

  // Close menu on click outside
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const selectedProject = projects.find((p) => p.project_id === selectedProjectId);

  const explorerData = useMemo(() => {
    if (images.length === 0) return [];
    return [
      {
        id: "images",
        label: `Images (${images.length})`,
        children: images.map((img) => ({
          id: img.id,
          label: img.prompt.length > 30 ? img.prompt.slice(0, 30) + "..." : img.prompt,
        })),
      },
    ];
  }, [images]);

  const entries = useMemo(
    () =>
      buildLeftMenuEntries(explorerData, {
        expandedIds,
        selectedNodeId: selectedImageId,
        onGroupActivate: (id) =>
          setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          }),
        onItemSelect: (id) => selectImage(id),
      }),
    [explorerData, expandedIds, selectedImageId, selectImage],
  );

  return (
    <div className={styles.root}>
      <div className={styles.projectSelector} ref={menuRef}>
        <span className={styles.label}>Project</span>
        <button
          type="button"
          className={styles.projectButton}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className={styles.projectName}>
            {selectedProject?.name ?? "Select a project"}
          </span>
          <ChevronDown size={12} />
        </button>
        {menuOpen && (
          <div className={styles.projectMenu}>
            {projects.map((p) => (
              <button
                key={p.project_id}
                type="button"
                className={`${styles.projectMenuItem} ${p.project_id === selectedProjectId ? styles.projectMenuItemActive : ""}`}
                onClick={() => {
                  setSelectedProjectId(p.project_id);
                  setMenuOpen(false);
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {!selectedProjectId ? (
        <div className={styles.emptyArea}>
          <EmptyState icon={<Box size={24} />}>
            Select a project to start generating.
          </EmptyState>
        </div>
      ) : images.length === 0 ? (
        <div className={styles.emptyArea}>
          <EmptyState icon={<ImageIcon size={24} />}>
            Generate your first image to get started.
          </EmptyState>
        </div>
      ) : (
        <LeftMenuTree
          ariaLabel="Assets"
          entries={entries}
        />
      )}
    </div>
  );
}
