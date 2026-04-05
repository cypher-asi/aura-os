import { useState } from "react";
import { Text, Button } from "@cypher-asi/zui";
import { Bot, CheckSquare, BarChart3 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { PanelSearch } from "../../components/PanelSearch";
import { FileExplorer } from "../../components/FileExplorer";
import { useProjectActions } from "../../stores/project-action-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { useTerminalTarget } from "../../hooks/use-terminal-target";
import { projectAgentRoute, projectStatsRoute, projectWorkRoute } from "../../utils/mobileNavigation";
import styles from "./ProjectFilesView.module.css";

export function ProjectFilesView() {
  const { isMobileLayout } = useAuraCapabilities();
  const ctx = useProjectActions();
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const { remoteAgentId, remoteWorkspacePath, workspacePath } = useTerminalTarget({ projectId });
  const listedProject = useProjectsListStore((state) => (
    projectId ? state.projects.find((candidate) => candidate.project_id === projectId) ?? null : null
  ));
  const project = ctx?.project ?? listedProject;
  const rootPath = workspacePath ?? null;
  const workspaceSourceLabel = remoteAgentId ? "Remote agent workspace" : "Agent workspace";
  const workspaceDisplay = remoteWorkspacePath ?? workspacePath ?? null;
  const hasRemoteAgent = Boolean(remoteAgentId);

  if (isMobileLayout) {
    const projectPath = workspacePath?.trim();
    const mobileTitle = hasRemoteAgent ? "Files stay on the remote agent" : "Files stay with the attached agent";
    const mobileDescription = hasRemoteAgent
      ? "Use Agent, Execution, or Stats while we wire remote file browsing directly into this view."
      : "Use the desktop app when you need to browse a local agent workspace from this project.";

    return (
      <div className={styles.mobileRemoteRoot}>
        <div className={styles.mobileRemoteCard}>
          <Text size="xs" variant="muted" className={styles.mobileRemoteEyebrow}>
            Agent workspace
          </Text>
          <Text size="lg" weight="medium">
            {mobileTitle}
          </Text>
          <Text variant="muted" size="sm">
            {mobileDescription}
          </Text>
          {project ? (
            <div className={styles.mobileRemoteMeta}>
              <Text size="sm" weight="medium">
                {project.name}
              </Text>
              {projectPath ? (
                <Text variant="muted" size="sm">
                  Agent path: {projectPath}
                </Text>
              ) : null}
            </div>
          ) : null}
          {project?.project_id ? (
            <div className={styles.mobileRemoteActions}>
              <Button variant="secondary" icon={<Bot size={16} />} onClick={() => navigate(projectAgentRoute(project.project_id))}>
                Open Agent
              </Button>
              <Button variant="secondary" icon={<CheckSquare size={16} />} onClick={() => navigate(projectWorkRoute(project.project_id))}>
                Open Execution
              </Button>
              <Button variant="secondary" icon={<BarChart3 size={16} />} onClick={() => navigate(projectStatsRoute(project.project_id))}>
                Open Stats
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    );
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
          placeholder="Search files..."
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
