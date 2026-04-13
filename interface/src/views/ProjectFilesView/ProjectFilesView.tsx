import { useState } from "react";
import { Text } from "@cypher-asi/zui";
import { Navigate, useParams } from "react-router-dom";
import { PanelSearch } from "../../components/PanelSearch";
import { FileExplorer } from "../../components/FileExplorer";
import { useProjectActions } from "../../stores/project-action-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { useTerminalTarget } from "../../hooks/use-terminal-target";
import { projectAgentRoute } from "../../utils/mobileNavigation";
import styles from "./ProjectFilesView.module.css";

export function ProjectFilesView() {
  const { isMobileLayout } = useAuraCapabilities();
  const ctx = useProjectActions();
  const { projectId } = useParams<{ projectId: string }>();
  const { remoteAgentId, remoteWorkspacePath, workspacePath } = useTerminalTarget({ projectId });
  const listedProject = useProjectsListStore((state) => (
    projectId ? state.projects.find((candidate) => candidate.project_id === projectId) ?? null : null
  ));
  const project = ctx?.project ?? listedProject;
  const rootPath = workspacePath ?? null;
  const workspaceSourceLabel = remoteAgentId ? "Remote agent workspace" : "Agent workspace";
  const workspaceDisplay = remoteWorkspacePath ?? workspacePath ?? null;

  if (isMobileLayout) {
    const targetProjectId = project?.project_id ?? projectId;
    if (targetProjectId) {
      return <Navigate to={projectAgentRoute(targetProjectId)} replace />;
    }
    return null;
  }

  return (
    <ProjectFilesContent
      rootPath={rootPath}
      remoteAgentId={remoteAgentId}
      workspaceSourceLabel={workspaceSourceLabel}
      workspaceDisplay={workspaceDisplay}
    />
  );
}

interface ProjectFilesContentProps {
  rootPath: string | null;
  remoteAgentId?: string;
  workspaceSourceLabel: string;
  workspaceDisplay: string | null;
}

function ProjectFilesContent({
  rootPath,
  remoteAgentId,
  workspaceSourceLabel,
  workspaceDisplay,
}: ProjectFilesContentProps) {
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div className={styles.container}>
      <div className={styles.desktopSummary}>
        <div className={styles.desktopSummaryText}>
          <Text size="xs" variant="muted" className={styles.desktopEyebrow}>
            Files
          </Text>
          <Text size="sm" weight="medium">
            {workspaceSourceLabel}
          </Text>
          {workspaceDisplay ? (
            <Text variant="muted" size="sm" className={styles.desktopWorkspacePath}>
              {workspaceDisplay}
            </Text>
          ) : null}
        </div>
      </div>
      <div className={styles.searchHeader}>
        <PanelSearch
          placeholder="Search"
          value={searchQuery}
          onChange={setSearchQuery}
        />
      </div>
      <div className={styles.explorerArea}>
        <FileExplorer
          rootPath={rootPath ?? undefined}
          remoteAgentId={remoteAgentId}
          searchQuery={searchQuery}
        />
      </div>
    </div>
  );
}
