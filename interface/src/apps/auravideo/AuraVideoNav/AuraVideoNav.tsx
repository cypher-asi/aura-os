import { createElement, useEffect, useMemo, useState } from "react";
import { PageEmptyState } from "@cypher-asi/zui";
import { FolderGit2, Film } from "lucide-react";
import { useAuraVideoStore } from "../../../stores/auravideo-store";
import {
  getMostRecentProject,
  useProjectsListStore,
} from "../../../stores/projects-list-store";
import { LeftMenuTree, buildLeftMenuEntries } from "../../../features/left-menu";
import {
  buildProjectRowAppearance,
  useProjectAppearancesByProject,
} from "../../../features/project-row-appearance";
import { getLastProject } from "../../../utils/storage";
import styles from "./AuraVideoNav.module.css";

export function AuraVideoNav() {
  const projects = useProjectsListStore((s) => s.projects);
  const selectedProjectId = useAuraVideoStore((s) => s.selectedProjectId);
  const setSelectedProjectId = useAuraVideoStore((s) => s.setSelectedProjectId);
  const videos = useAuraVideoStore((s) => s.videos);
  const currentVideo = useAuraVideoStore((s) => s.currentVideo);
  const selectVideo = useAuraVideoStore((s) => s.selectVideo);
  const loadProjectArtifacts = useAuraVideoStore((s) => s.loadProjectArtifacts);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (selectedProjectId) return;
    if (projects.length === 0) return;
    const lastId = getLastProject();
    const target =
      (lastId && projects.find((p) => p.project_id === lastId)) ??
      getMostRecentProject(projects);
    if (target) {
      setSelectedProjectId(target.project_id);
      setExpandedIds((prev) => {
        if (prev.has(target.project_id)) return prev;
        const next = new Set(prev);
        next.add(target.project_id);
        return next;
      });
    }
  }, [projects, selectedProjectId, setSelectedProjectId]);

  const selectedNodeId = currentVideo ? `video:${currentVideo.id}` : null;

  const appearanceByProject = useProjectAppearancesByProject();

  const explorerData = useMemo(() => {
    return projects.map((project) => {
      const isActive = selectedProjectId === project.project_id;
      const projectVideos = isActive ? videos : [];
      return {
        id: project.project_id,
        label: project.name,
        // Mirror the other left-panel apps: accent stripe, custom icon,
        // and name color from the project's appearance.json.
        ...buildProjectRowAppearance(
          project.project_id,
          appearanceByProject.get(project.project_id),
        ),
        children: projectVideos.map((video) => ({
          id: `video:${video.id}`,
          label:
            video.prompt.length > 30
              ? video.prompt.slice(0, 30) + "..."
              : video.prompt || "Untitled video",
          icon: createElement(Film, { size: 14 }),
        })),
      };
    });
  }, [projects, videos, selectedProjectId, appearanceByProject]);

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
          if (id.startsWith("video:")) {
            selectVideo(id.slice(6));
          }
        },
      }),
    [
      explorerData, expandedIds, selectedNodeId, selectVideo,
      setSelectedProjectId, loadProjectArtifacts, selectedProjectId,
    ],
  );

  if (projects.length === 0) {
    return (
      <div className={styles.root}>
        <PageEmptyState
          icon={<FolderGit2 size={32} />}
          title="No projects yet"
          description="Create a project to start generating videos."
        />
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <LeftMenuTree ariaLabel="Projects" entries={entries} />
    </div>
  );
}
