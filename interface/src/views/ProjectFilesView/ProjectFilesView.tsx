import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Spinner, Text } from "@cypher-asi/zui";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { PanelSearch } from "../../components/PanelSearch";
import { FileExplorer } from "../../components/FileExplorer";
import { useProjectActions } from "../../stores/project-action-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { useTerminalTarget } from "../../hooks/use-terminal-target";
import styles from "./ProjectFilesView.module.css";

export function ProjectFilesView() {
  const { isMobileClient, isMobileLayout } = useAuraCapabilities();
  const ctx = useProjectActions();
  const { projectId } = useParams<{ projectId: string }>();
  const { remoteAgentId, remoteWorkspacePath, workspacePath, status } = useTerminalTarget({ projectId });
  const listedProject = useProjectsListStore((state) => (
    projectId ? state.projects.find((candidate) => candidate.project_id === projectId) ?? null : null
  ));
  const project = ctx?.project ?? listedProject;
  const rootPath = workspacePath ?? null;
  const workspaceSourceLabel = remoteAgentId ? "Remote agent workspace" : "Agent workspace";
  const workspaceDisplay = remoteWorkspacePath ?? workspacePath ?? null;

  if (isMobileClient && isMobileLayout) {
    return (
      <MobileProjectFilesContent
        rootPath={remoteWorkspacePath ?? null}
        remoteAgentId={remoteAgentId}
        status={status}
        workspaceSourceLabel="Remote workspace"
        workspaceDisplay={workspaceDisplay}
        projectName={project?.name ?? "Project"}
      />
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

function MobileProjectFilesContent({
  rootPath,
  remoteAgentId,
  status,
  workspaceSourceLabel,
  workspaceDisplay,
  projectName,
}: ProjectFilesContentProps & { projectName: string; status: "loading" | "ready" | "error" }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedFilePath = searchParams.get("file");
  const canBrowseRemoteWorkspace = Boolean(rootPath) && Boolean(remoteAgentId);

  const handleFileSelect = useCallback((filePath: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("file", filePath);
      return next;
    });
  }, [setSearchParams]);

  const clearSelectedFile = useCallback(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("file");
      return next;
    });
  }, [setSearchParams]);

  if (status === "loading") {
    return (
      <div className={styles.mobileRemoteRoot}>
        <div className={styles.mobileRemoteCard}>
          <div className={styles.mobileRemoteHeader}>
            <Text size="xs" variant="muted" className={styles.mobileRemoteEyebrow}>
              Files
            </Text>
            <Text size="lg" weight="medium">
              Remote workspace is still loading.
            </Text>
            <Text size="sm" variant="muted">
              Aura is resolving the active remote workspace for this project. File browsing will appear here once it is ready.
            </Text>
          </div>
          <div className={styles.loadingState}>
            <Spinner size="sm" />
          </div>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className={styles.mobileRemoteRoot}>
        <div className={styles.mobileRemoteCard}>
          <div className={styles.mobileRemoteHeader}>
            <Text size="xs" variant="muted" className={styles.mobileRemoteEyebrow}>
              Files
            </Text>
            <Text size="lg" weight="medium">
              Remote workspace data could not load.
            </Text>
            <Text size="sm" variant="muted">
              Aura could not resolve the live workspace details just now. Return to Agent or try again in a moment.
            </Text>
          </div>
          <div className={styles.mobileRemoteMeta}>
            <Text size="sm" weight="medium">{projectName}</Text>
            <Text size="sm" variant="muted">{workspaceDisplay ?? "No remote workspace reported yet."}</Text>
          </div>
        </div>
      </div>
    );
  }

  if (!canBrowseRemoteWorkspace || !rootPath || !remoteAgentId) {
    return (
      <div className={styles.mobileRemoteRoot}>
        <div className={styles.mobileRemoteCard}>
          <div className={styles.mobileRemoteHeader}>
            <Text size="xs" variant="muted" className={styles.mobileRemoteEyebrow}>
              Files
            </Text>
            <Text size="lg" weight="medium">
              Workspace files will appear here when this project has a live remote workspace.
            </Text>
            <Text size="sm" variant="muted">
              Once Aura reports the live workspace, you will be able to browse and preview files here.
            </Text>
          </div>
          <div className={styles.mobileRemoteMeta}>
            <Text size="sm" weight="medium">{projectName}</Text>
            <Text size="sm" variant="muted">{workspaceDisplay ?? "No remote workspace reported yet."}</Text>
          </div>
        </div>
      </div>
    );
  }

  if (selectedFilePath) {
    return (
      <MobileRemoteFilePreview
        filePath={selectedFilePath}
        remoteAgentId={remoteAgentId}
        workspaceDisplay={workspaceDisplay}
        onBack={clearSelectedFile}
      />
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.mobileSummary}>
        <div className={styles.mobileSummaryText}>
          <Text size="xs" variant="muted" className={styles.mobileRemoteEyebrow}>
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
          placeholder="Search files"
          value={searchQuery}
          onChange={setSearchQuery}
        />
      </div>
      <div className={styles.explorerArea}>
        <FileExplorer
          rootPath={rootPath}
          remoteAgentId={remoteAgentId}
          searchQuery={searchQuery}
          onFileSelect={handleFileSelect}
        />
      </div>
    </div>
  );
}

function MobileRemoteFilePreview({
  filePath,
  remoteAgentId,
  workspaceDisplay,
  onBack,
}: {
  filePath: string;
  remoteAgentId: string;
  workspaceDisplay: string | null;
  onBack: () => void;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [state, setState] = useState<{
    loading: boolean;
    content: string | null;
    error: string | null;
  }>({
    loading: true,
    content: null,
    error: null,
  });

  const previewSupported = useMemo(() => isMobilePreviewableTextFile(filePath), [filePath]);
  const fileName = useMemo(() => filePath.split(/[\\/]/).pop() ?? filePath, [filePath]);

  useEffect(() => {
    if (!previewSupported) {
      setState({ loading: false, content: null, error: null });
      return;
    }

    let cancelled = false;
    setState({ loading: true, content: null, error: null });

    void api.swarm.readRemoteFile(remoteAgentId, filePath)
      .then((result) => {
        if (cancelled) return;
        if (result.ok && typeof result.content === "string") {
          setState({ loading: false, content: result.content, error: null });
          return;
        }
        setState({
          loading: false,
          content: null,
          error: result.error ?? "Could not load this remote file.",
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          loading: false,
          content: null,
          error: error instanceof Error ? error.message : "Could not load this remote file.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, previewSupported, refreshKey, remoteAgentId]);

  return (
    <div className={styles.mobilePreviewRoot}>
      <div className={styles.mobilePreviewHeader}>
        <div className={styles.mobilePreviewHeaderActions}>
          <button
            type="button"
            className={styles.inlineBackButton}
            onClick={onBack}
          >
            <ArrowLeft size={14} aria-hidden="true" />
            <span>Back to files</span>
          </button>
          {previewSupported ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRefreshKey((current) => current + 1)}
            >
              <RefreshCw size={14} />
              Refresh
            </Button>
          ) : null}
        </div>
        <div className={styles.mobilePreviewHeaderText}>
          <Text size="sm" weight="medium">{fileName}</Text>
          <Text size="xs" variant="muted">{workspaceDisplay ?? filePath}</Text>
        </div>
      </div>
      <div className={styles.mobilePreviewBody}>
        <div className={styles.mobilePreviewPath}>
          <Text size="xs" variant="muted">{filePath}</Text>
        </div>
        {!previewSupported ? (
          <div className={styles.mobileRemoteCard}>
            <Text size="sm" weight="medium">Preview this file on desktop for now.</Text>
            <Text size="sm" variant="muted">
              Mobile preview currently supports text, code, markdown, config, and log files from a remote workspace.
            </Text>
          </div>
        ) : state.loading ? (
          <div className={styles.mobilePreviewLoading}>
            <Spinner size="sm" />
          </div>
        ) : state.error ? (
          <div className={styles.mobileRemoteCard}>
            <Text size="sm" weight="medium">Could not load file</Text>
            <Text size="sm" variant="muted">{state.error}</Text>
          </div>
        ) : (
          <pre className={styles.mobilePreviewContent}>{state.content ?? ""}</pre>
        )}
      </div>
    </div>
  );
}

function isMobilePreviewableTextFile(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    /\.(txt|md|markdown|json|yml|yaml|toml|ini|cfg|conf|env|log|csv|ts|tsx|js|jsx|mjs|cjs|css|scss|html|xml|sh|bash|zsh|py|go|rs|java|kt|swift|sql)$/.test(lower)
    || !lower.includes(".")
  );
}
