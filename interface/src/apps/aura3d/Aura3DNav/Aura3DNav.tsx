import { createElement, useMemo, useState } from "react";
import { PageEmptyState } from "@cypher-asi/zui";
import { FolderGit2, ImageIcon, Box } from "lucide-react";
import { useAura3DStore } from "../../../stores/aura3d-store";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { LeftMenuTree, buildLeftMenuEntries } from "../../../features/left-menu";
import styles from "./Aura3DNav.module.css";

export function Aura3DNav() {
  const projects = useProjectsListStore((s) => s.projects);
  const selectedProjectId = useAura3DStore((s) => s.selectedProjectId);
  const setSelectedProjectId = useAura3DStore((s) => s.setSelectedProjectId);
  const images = useAura3DStore((s) => s.images);
  const models = useAura3DStore((s) => s.models);
  const selectedImageId = useAura3DStore((s) => s.selectedImageId);
  const selectedModelId = useAura3DStore((s) => s.selectedModelId);
  const selectImage = useAura3DStore((s) => s.selectImage);
  const selectModel = useAura3DStore((s) => s.selectModel);
  const loadProjectArtifacts = useAura3DStore((s) => s.loadProjectArtifacts);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(),
  );

  const selectedNodeId = selectedImageId
    ? `img:${selectedImageId}`
    : selectedModelId
      ? `model:${selectedModelId}`
      : null;

  const explorerData = useMemo(() => {
    return projects.map((project) => {
      const isActive = selectedProjectId === project.project_id;
      const projectImages = isActive ? images : [];
      const projectModels = isActive ? models : [];
      return {
        id: project.project_id,
        label: project.name,
        children: [
          ...projectImages.map((img) => ({
            id: `img:${img.id}`,
            label: img.prompt.length > 30 ? img.prompt.slice(0, 30) + "..." : img.prompt,
            icon: createElement(ImageIcon, { size: 14 }),
          })),
          ...projectModels.map((model) => {
            const sourceImage = projectImages.find((img) => img.id === model.sourceImageId);
            const label = sourceImage
              ? `3D: ${sourceImage.prompt.length > 25 ? sourceImage.prompt.slice(0, 25) + "..." : sourceImage.prompt}`
              : `3D Model (${model.id.slice(0, 6)})`;
            return {
              id: `model:${model.id}`,
              label,
              icon: createElement(Box, { size: 14 }),
            };
          }),
        ],
      };
    });
  }, [projects, images, models, selectedProjectId]);

  const entries = useMemo(
    () =>
      buildLeftMenuEntries(explorerData, {
        expandedIds,
        selectedNodeId,
        onGroupActivate: (id) => {
          if (selectedProjectId !== id) {
            setSelectedProjectId(id);
          }
          loadProjectArtifacts(id);
          setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
        },
        onItemSelect: (id) => {
          if (id.startsWith("img:")) {
            selectImage(id.slice(4));
          } else if (id.startsWith("model:")) {
            selectModel(id.slice(6));
          }
        },
      }),
    [explorerData, expandedIds, selectedNodeId, selectImage, selectModel, setSelectedProjectId, loadProjectArtifacts],
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
