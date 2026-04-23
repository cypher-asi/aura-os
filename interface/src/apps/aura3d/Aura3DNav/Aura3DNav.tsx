import { useEffect, useRef, useState } from "react";
import { Box, ImageIcon, ChevronDown } from "lucide-react";
import { useAura3DStore } from "../../../stores/aura3d-store";
import { useProjectsListStore } from "../../../stores/projects-list-store";
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
        <>
          <div className={styles.sectionHeader}>Images</div>
          <div className={styles.list}>
            {images.map((image) => (
              <button
                key={image.id}
                type="button"
                className={`${styles.item} ${image.id === selectedImageId ? styles.itemActive : ""}`}
                onClick={() => selectImage(image.id)}
              >
                <img
                  src={image.imageUrl}
                  alt={image.prompt}
                  className={styles.thumb}
                />
                <div className={styles.itemInfo}>
                  <span className={styles.itemName}>{image.prompt}</span>
                  <span className={styles.itemMeta}>{image.model}</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
