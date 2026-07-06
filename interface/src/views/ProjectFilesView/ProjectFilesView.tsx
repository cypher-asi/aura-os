import { useState } from "react";
import { Text } from "@cypher-asi/zui";
import { PanelSearch } from "../../components/PanelSearch";
import { FileExplorer } from "../../components/FileExplorer";
import { useProjectActions } from "../../stores/project-action-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useTerminalTarget } from "../../hooks/use-terminal-target";
import { resolveWorkspaceAccess } from "../../shared/lib/workspace-access";
import styles from "./ProjectFilesView.module.css";

export function ProjectFilesView() {
  const ctx = useProjectActions();
  const projectId = ctx?.project.project_id;
  const { remoteAgentId, remoteWorkspacePath, workspacePath, status } = useTerminalTarget({ projectId });
  const { features } = useAuraCapabilities();
  const workspaceAccess = resolveWorkspaceAccess({
    workspacePath,
    remoteWorkspacePath,
    remoteAgentId,
    linkedWorkspace: features.linkedWorkspace,
  });
  const rootPath = workspaceAccess.workspacePath ?? null;
  const workspaceSourceLabel = workspaceAccess.kind === "remote" ? "Remote agent workspace" : "Agent workspace";
  const workspaceDisplay = remoteWorkspacePath ?? workspacePath ?? null;
  const emptyMessage = workspaceAccess.canUseWorkspace
    ? null
    : remoteAgentId
      ? "The attached remote agent has not reported a live workspace yet."
      : features.linkedWorkspace
        ? "This project does not currently expose a live local agent workspace."
        : "File browsing for local workspaces is available in Aura Desktop.";

  if (!projectId || status === "loading") {
    return null;
  }

  return (
    <ProjectFilesContent
      rootPath={rootPath}
      remoteAgentId={remoteAgentId}
      workspaceSourceLabel={workspaceSourceLabel}
      workspaceDisplay={workspaceDisplay}
      emptyMessage={emptyMessage}
    />
  );
}

interface ProjectFilesContentProps {
  rootPath: string | null;
  remoteAgentId?: string;
  workspaceSourceLabel: string;
  workspaceDisplay: string | null;
  emptyMessage: string | null;
}

function ProjectFilesContent({
  rootPath,
  remoteAgentId,
  workspaceSourceLabel,
  workspaceDisplay,
  emptyMessage,
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
        {rootPath ? (
          <FileExplorer
            rootPath={rootPath}
            remoteAgentId={remoteAgentId}
            searchQuery={searchQuery}
          />
        ) : (
          <div className={styles.emptyState}>
            <Text size="sm" variant="muted">
              {emptyMessage ?? "Workspace files are not available for this project yet."}
            </Text>
          </div>
        )}
      </div>
    </div>
  );
}
