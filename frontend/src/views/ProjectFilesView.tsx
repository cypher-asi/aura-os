import { useState } from "react";
import { useParams } from "react-router-dom";
import { PanelSearch } from "../components/PanelSearch";
import { FileExplorer } from "../components/FileExplorer";
import { useProjectContext } from "../context/ProjectContext";
import { useProjectsList } from "../apps/projects/useProjectsList";
import { getProjectWorkspaceRoot } from "../utils/projectWorkspace";

export function ProjectFilesView() {
  const [searchQuery, setSearchQuery] = useState("");
  const ctx = useProjectContext();
  const { projectId } = useParams<{ projectId: string }>();
  const { projects } = useProjectsList();
  const project = ctx?.project ?? projects.find((candidate) => candidate.project_id === projectId) ?? null;
  const rootPath = getProjectWorkspaceRoot(project);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
        flex: 1,
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "var(--space-3)", borderBottom: "1px solid var(--color-border)" }}>
        <PanelSearch
          placeholder="Search files..."
          value={searchQuery}
          onChange={setSearchQuery}
        />
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0, height: "100%", overflow: "hidden" }}>
        <FileExplorer rootPath={rootPath ?? undefined} searchQuery={searchQuery} />
      </div>
    </div>
  );
}
