import { useState } from "react";
import { useParams } from "react-router-dom";
import { PanelSearch } from "../../components/PanelSearch";
import { FileExplorer } from "../../components/FileExplorer";
import { useProjectContext } from "../../stores/project-action-store";
import { useProjectsList } from "../../apps/projects/useProjectsList";
import { getProjectWorkspaceRoot } from "../../utils/projectWorkspace";
import styles from "./ProjectFilesView.module.css";

export function ProjectFilesView() {
  const [searchQuery, setSearchQuery] = useState("");
  const ctx = useProjectContext();
  const { projectId } = useParams<{ projectId: string }>();
  const { projects } = useProjectsList();
  const project = ctx?.project ?? projects.find((candidate) => candidate.project_id === projectId) ?? null;
  const rootPath = getProjectWorkspaceRoot(project);

  return (
    <div className={styles.container}>
      <div className={styles.searchHeader}>
        <PanelSearch
          placeholder=""
          value={searchQuery}
          onChange={setSearchQuery}
        />
      </div>
      <div className={styles.explorerArea}>
        <FileExplorer rootPath={rootPath ?? undefined} searchQuery={searchQuery} />
      </div>
    </div>
  );
}
