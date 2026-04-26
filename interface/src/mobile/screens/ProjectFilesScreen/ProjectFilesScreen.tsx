import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Spinner, Text } from "@cypher-asi/zui";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../../../api/client";
import { FileExplorer } from "../../../components/FileExplorer";
import { PanelSearch } from "../../../components/PanelSearch";
import { useTerminalTarget } from "../../../hooks/use-terminal-target";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import styles from "./ProjectFilesScreen.module.css";

interface ProjectFilesContentProps {
  rootPath: string | null;
  remoteAgentId?: string;
  status: "loading" | "ready" | "error";
  workspaceSourceLabel: string;
  workspaceDisplay: string | null;
  projectName: string;
}

export function MobileProjectFilesScreen() {
  const { projectId } = useParams<{ projectId: string }>();
  const { remoteAgentId, remoteWorkspacePath, workspacePath, status } = useTerminalTarget({ projectId });
  const project = useProjectsListStore((state) => (
    projectId ? state.projects.find((candidate) => candidate.project_id === projectId) ?? null : null
  ));

  if (!projectId) return null;

  return (
    <MobileProjectFilesContent
      rootPath={remoteWorkspacePath ?? null}
      remoteAgentId={remoteAgentId}
      status={status}
      workspaceSourceLabel="Remote workspace"
      workspaceDisplay={remoteWorkspacePath ?? workspacePath ?? null}
      projectName={project?.name ?? "Project"}
    />
  );
}

function MobileProjectFilesContent({
  rootPath,
  remoteAgentId,
  status,
  workspaceSourceLabel,
  workspaceDisplay,
  projectName,
}: ProjectFilesContentProps) {
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
      <div className={styles.remoteRoot}>
        <div className={styles.remoteCard}>
          <div className={styles.remoteHeader}>
            <Text size="xs" variant="muted" className={styles.eyebrow}>Files</Text>
            <Text size="lg" weight="medium">Remote workspace is still loading.</Text>
            <Text size="sm" variant="muted">
              AURA is resolving the active remote workspace for this project.
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
      <div className={styles.remoteRoot}>
        <div className={styles.remoteCard}>
          <div className={styles.remoteHeader}>
            <Text size="xs" variant="muted" className={styles.eyebrow}>Files</Text>
            <Text size="lg" weight="medium">Remote workspace data could not load.</Text>
            <Text size="sm" variant="muted">
              AURA could not resolve the live workspace details just now.
            </Text>
          </div>
          <div className={styles.remoteMeta}>
            <Text size="sm" weight="medium">{projectName}</Text>
            <Text size="sm" variant="muted">Waiting for a live remote workspace.</Text>
          </div>
        </div>
      </div>
    );
  }

  if (!canBrowseRemoteWorkspace || !rootPath || !remoteAgentId) {
    return (
      <div className={styles.remoteRoot}>
        <div className={styles.remoteCard}>
          <div className={styles.remoteHeader}>
            <Text size="xs" variant="muted" className={styles.eyebrow}>Files</Text>
            <Text size="lg" weight="medium">
              Workspace files will appear here when this project has a live remote workspace.
            </Text>
            <Text size="sm" variant="muted">
              Once AURA reports the live workspace, you will be able to browse and preview files here.
            </Text>
          </div>
          <div className={styles.remoteMeta}>
            <Text size="sm" weight="medium">{projectName}</Text>
            <Text size="sm" variant="muted">Waiting for a live remote workspace.</Text>
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
      <div className={styles.summary}>
        <Text size="sm" weight="medium">{workspaceSourceLabel}</Text>
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
        setState({ loading: false, content: null, error: getRemoteFileErrorDescription() });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ loading: false, content: null, error: getRemoteFileErrorDescription() });
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, previewSupported, refreshKey, remoteAgentId]);

  return (
    <div className={styles.previewRoot}>
      <div className={styles.previewHeader}>
        <div className={styles.previewHeaderActions}>
          <button type="button" className={styles.inlineBackButton} onClick={onBack}>
            <ArrowLeft size={14} aria-hidden="true" />
            <span>Back to files</span>
          </button>
          {previewSupported ? (
            <Button variant="ghost" size="sm" onClick={() => setRefreshKey((current) => current + 1)}>
              <RefreshCw size={14} />
              Refresh
            </Button>
          ) : null}
        </div>
        <div className={styles.previewHeaderText}>
          <Text size="sm" weight="medium">{fileName}</Text>
          <Text size="xs" variant="muted">{workspaceDisplay ?? filePath}</Text>
        </div>
      </div>
      <div className={styles.previewBody}>
        <div className={styles.previewPath}>
          <Text size="xs" variant="muted">{filePath}</Text>
        </div>
        {!previewSupported ? (
          <div className={styles.remoteCard}>
            <Text size="sm" weight="medium">Preview this file on desktop for now.</Text>
            <Text size="sm" variant="muted">
              Mobile preview currently supports text, code, markdown, config, and log files from a remote workspace.
            </Text>
          </div>
        ) : state.loading ? (
          <div className={styles.previewLoading}>
            <Spinner size="sm" />
          </div>
        ) : state.error ? (
          <div className={styles.remoteCard}>
            <Text size="sm" weight="medium">Could not load file</Text>
            <Text size="sm" variant="muted">{state.error}</Text>
          </div>
        ) : (
          <pre className={styles.previewContent}>{state.content ?? ""}</pre>
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

function getRemoteFileErrorDescription(): string {
  return "This remote file is temporarily unavailable. Try again in a moment.";
}
