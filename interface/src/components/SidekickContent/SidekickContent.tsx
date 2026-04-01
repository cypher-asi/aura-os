import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button, Text } from "@cypher-asi/zui";
import { ArrowLeft, GitBranch, RefreshCw } from "lucide-react";
import { EmptyState } from "../EmptyState";
import { PanelSearch } from "../PanelSearch";
import { PreviewContent, PreviewHeader } from "../Preview";
import { StatusBadge } from "../StatusBadge";
import { api } from "../../api/client";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useShallow } from "zustand/react/shallow";
import { useProjectContext } from "../../stores/project-action-store";
import { SpecList } from "../../views/SpecList";
import { TaskList } from "../../views/TaskList";
import { StatsDashboard } from "../../views/StatsDashboard";
import { SessionList } from "../../views/SessionList";
import { SidekickLog } from "../../views/SidekickLog";
import { FileExplorer } from "../FileExplorer";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useTerminalTarget } from "../../hooks/use-terminal-target";
import styles from "../Sidekick/Sidekick.module.css";

function InfoPanel({
  project,
  workspacePath,
  remoteAgentId,
  onClose,
}: {
  project: import("../../types").Project;
  workspacePath?: string;
  remoteAgentId?: string;
  onClose: () => void;
}) {
  const workspaceLabel = workspacePath ?? "—";
  const [openingWorkspace, setOpeningWorkspace] = useState(false);
  const [openWorkspaceError, setOpenWorkspaceError] = useState<string | null>(null);
  const canOpenWorkspace = Boolean(workspacePath) && !remoteAgentId;

  const handleOpenWorkspace = async () => {
    if (!workspacePath || openingWorkspace || remoteAgentId) {
      return;
    }
    setOpenWorkspaceError(null);
    setOpeningWorkspace(true);
    try {
      const result = await api.openPath(workspacePath);
      if (!result.ok) {
        setOpenWorkspaceError(result.error ?? "Could not open workspace folder.");
      }
    } catch {
      setOpenWorkspaceError("Could not open workspace folder.");
    } finally {
      setOpeningWorkspace(false);
    }
  };

  return (
    <div className={styles.infoArea}>
      <div className={styles.infoHeader}>
        <Button variant="ghost" size="sm" iconOnly icon={<ArrowLeft size={14} />} onClick={onClose} />
        <Text size="sm" className={styles.infoBoldTitle}>Project Info</Text>
      </div>
      <div className={styles.infoGrid}>
        <Text variant="muted" size="sm" as="span">Status</Text>
        <span><StatusBadge status={project.current_status} /></span>
        <Text variant="muted" size="sm" as="span">Workspace</Text>
        <span className={styles.infoWorkspaceCell}>
          {canOpenWorkspace ? (
            <button
              type="button"
              className={styles.infoWorkspaceLink}
              onClick={handleOpenWorkspace}
              disabled={openingWorkspace}
              title={workspacePath}
            >
              {workspaceLabel}
            </button>
          ) : (
            <Text size="sm" as="span">{workspaceLabel}</Text>
          )}
          {remoteAgentId ? (
            <Text size="xs" variant="muted" as="span">Attached to remote agent workspace</Text>
          ) : null}
          {openWorkspaceError ? (
            <Text size="xs" variant="muted" as="span">{openWorkspaceError}</Text>
          ) : null}
        </span>
        <Text variant="muted" size="sm" as="span">Created</Text>
        <Text size="sm" as="span">{new Date(project.created_at).toLocaleString()}</Text>

        <Text variant="muted" size="sm" as="span">Orbit</Text>
        <span className={styles.infoWorkspaceCell}>
          {project.orbit_owner && project.orbit_repo ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <GitBranch size={12} />
              <Text size="sm" as="span">{project.orbit_owner}/{project.orbit_repo}</Text>
            </span>
          ) : (
            <Text size="sm" variant="muted" as="span">Not linked</Text>
          )}
          {project.git_branch && (
            <Text size="xs" variant="muted" as="span">branch: {project.git_branch}</Text>
          )}
        </span>

        {project.git_repo_url && (
          <>
            <Text variant="muted" size="sm" as="span">Git URL</Text>
            <Text size="sm" as="span" style={{ wordBreak: "break-all" }}>{project.git_repo_url}</Text>
          </>
        )}
      </div>
    </div>
  );
}

const SEARCH_PLACEHOLDERS: Record<string, string> = {
  specs: "Search Specs...",
  tasks: "Search Tasks...",
  sessions: "Search Sessions...",
  files: "Search Files...",
  log: "Search Log...",
};

export function SidekickContent() {
  const { activeTab, showInfo, toggleInfo, previewItem } = useSidekickStore(
    useShallow((s) => ({
      activeTab: s.activeTab,
      showInfo: s.showInfo,
      toggleInfo: s.toggleInfo,
      previewItem: s.previewItem,
    })),
  );
  const ctx = useProjectContext();
  const [searchQuery, setSearchQuery] = useState("");
  const { features } = useAuraCapabilities();
  const { projectId, agentInstanceId } = useParams<{ projectId: string; agentInstanceId: string }>();
  const { remoteAgentId, remoteWorkspacePath, workspacePath } = useTerminalTarget({ projectId, agentInstanceId });
  const navigate = useNavigate();
  const [fileRefreshKey, setFileRefreshKey] = useState(0);

  const handleRemoteFileSelect = useCallback(
    (filePath: string) => {
      if (remoteAgentId) {
        navigate(`/ide?file=${encodeURIComponent(filePath)}&remoteAgentId=${encodeURIComponent(remoteAgentId)}`);
      }
    },
    [remoteAgentId, navigate],
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setSearchQuery(""));
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab]);

  if (!ctx) {
    return <EmptyState>Select a project to get started</EmptyState>;
  }

  const { project } = ctx;
  const remoteRoot = remoteWorkspacePath ?? null;
  const localRoot = !remoteAgentId ? (workspacePath ?? null) : null;
  const workspaceRoot = remoteAgentId ? remoteRoot : localRoot;
  const canBrowseLocal = features.linkedWorkspace && Boolean(localRoot);
  const canBrowseRemote = Boolean(remoteAgentId) && Boolean(remoteRoot);
  const canBrowseFiles = canBrowseLocal || canBrowseRemote;

  if (showInfo) {
    return (
      <InfoPanel
        project={project}
        workspacePath={workspacePath}
        remoteAgentId={remoteAgentId}
        onClose={() => toggleInfo("", null)}
      />
    );
  }

  const searchable = activeTab !== "stats";

  const filesContent = canBrowseFiles
    ? (
      <FileExplorer
        rootPath={workspaceRoot ?? undefined}
        searchQuery={searchQuery}
        remoteAgentId={remoteAgentId}
        onFileSelect={remoteAgentId ? handleRemoteFileSelect : undefined}
        refreshTrigger={fileRefreshKey}
      />
    )
    : (
      <div className={styles.emptyState}>
        <Text variant="muted" size="sm">
          {features.linkedWorkspace
            ? "Imported workspaces do not expose live host files."
            : "File browsing stays in the desktop app for now."}
        </Text>
      </div>
    );

  const tabContent: Record<string, React.ReactNode> = {
    specs: <SpecList searchQuery={searchQuery} />,
    tasks: <TaskList searchQuery={searchQuery} />,
    stats: <StatsDashboard />,
    sessions: <SessionList searchQuery={searchQuery} />,
    files: filesContent,
  };

  return (
    <div className={styles.sidekickBody}>
      {searchable && (
        <PanelSearch
          placeholder={SEARCH_PLACEHOLDERS[activeTab] ?? ""}
          value={searchQuery}
          onChange={setSearchQuery}
          action={activeTab === "files" ? (
            <button
              type="button"
              onClick={() => setFileRefreshKey((k) => k + 1)}
              title="Refresh file tree"
              aria-label="Refresh file tree"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 24, height: 24, border: "none", borderRadius: "var(--radius-sm)",
                background: "transparent", color: "var(--color-text-muted)", cursor: "pointer",
              }}
            >
              <RefreshCw size={14} />
            </button>
          ) : undefined}
        />
      )}
      <div className={styles.sidekickContent}>
        {activeTab !== "log" && (
          <div className={styles.tabContent}>
            {tabContent[activeTab]}
          </div>
        )}
        <div className={styles.tabContent} style={activeTab === "log" ? undefined : { display: "none" }}>
          <SidekickLog searchQuery={searchQuery} />
        </div>
      </div>
      {previewItem && (
        <div className={styles.previewOverlay}>
          <PreviewHeader />
          <PreviewContent />
        </div>
      )}
    </div>
  );
}
