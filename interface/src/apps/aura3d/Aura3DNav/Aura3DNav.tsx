import { useMemo, useState } from "react";
import { PageEmptyState } from "@cypher-asi/zui";
import { FolderGit2 } from "lucide-react";
import { useAura3DStore } from "../../../stores/aura3d-store";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { LeftMenuTree, buildLeftMenuEntries } from "../../../features/left-menu";
import styles from "./Aura3DNav.module.css";

export function Aura3DNav() {
  const projects = useProjectsListStore((s) => s.projects);
  const selectedProjectId = useAura3DStore((s) => s.selectedProjectId);
  const setSelectedProjectId = useAura3DStore((s) => s.setSelectedProjectId);
  const images = useAura3DStore((s) => s.images);
  const selectedImageId = useAura3DStore((s) => s.selectedImageId);
  const selectImage = useAura3DStore((s) => s.selectImage);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(projects.map((p) => p.project_id)),
  );

  const explorerData = useMemo(() => {
    return projects.map((project) => {
      const projectImages = selectedProjectId === project.project_id ? images : [];
      return {
        id: project.project_id,
        label: project.name,
        children: projectImages.map((img) => ({
          id: img.id,
          label: img.prompt.length > 30 ? img.prompt.slice(0, 30) + "..." : img.prompt,
        })),
      };
    });
  }, [projects, images, selectedProjectId]);

  const entries = useMemo(
    () =>
      buildLeftMenuEntries(explorerData, {
        expandedIds,
        selectedNodeId: selectedImageId,
        onGroupActivate: (id) => {
          setSelectedProjectId(id);
          setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
        },
        onItemSelect: (id) => selectImage(id),
      }),
    [explorerData, expandedIds, selectedImageId, selectImage, setSelectedProjectId],
  );

  if (projects.length === 0) {
    return (
      <div className={styles.root}>
        <PageEmptyState
          icon={<FolderGit2 size={32} />}
          title="No projects yet"
          description="Create a project to start generating 3D assets."
        />
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <LeftMenuTree
        ariaLabel="Projects"
        entries={entries}
      />
    </div>
  );
}
