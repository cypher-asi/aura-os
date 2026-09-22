import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Spinner, Text } from "@cypher-asi/zui";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../../../api/client";
import { FileExplorer } from "../../../components/FileExplorer";
import { PanelSearch } from "../../../components/PanelSearch";
import { SourceControlWorkbench } from "../../../components/SourceControlWorkbench";
import { useAuraCapabilities } from "../../../hooks/use-aura-capabilities";
import { useTerminalTarget } from "../../../hooks/use-terminal-target";
import type { HostedWorkspaceTarget } from "../../../shared/api/hosted-workspace";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import styles from "./ProjectFilesScreen.module.css";

interface ProjectFilesContentProps {
  projectId: string;
  rootPath: string | null;
  remoteAgentId?: string;
  hostedWorkspace?: HostedWorkspaceTarget;
  status: "loading" | "ready" | "error";
  workspaceSourceLabel: string;
  workspaceDisplay: string | null;
  projectName: string;
  sourceControlAgentInstanceId?: string;
}

export function MobileProjectFilesScreen() {
  const { projectId } = useParams<{ projectId: string }>();
  const [routeSearchParams] = useSearchParams();
  const requestedAgentInstanceId = routeSearchParams.get("instance") ?? undefined;
  const { hostedLocalHarness } = useAuraCapabilities();
  const {
    remoteAgentId,
    remoteAgentInstanceId,
    localAgentInstanceId,
    remoteWorkspacePath,
    workspacePath,
    status,
  } = useTerminalTarget({
    projectId,
    agentInstanceId: requestedAgentInstanceId,
    preferLocalWorkspace: hostedLocalHarness,
  });
  const project = useProjectsListStore((state) => (
    projectId ? state.projects.find((candidate) => candidate.project_id === projectId) ?? null : null
  ));

  if (!projectId) return null;

  const hostedWorkspace = hostedLocalHarness && localAgentInstanceId
    ? { projectId, agentInstanceId: localAgentInstanceId }
    : undefined;

  return (
    <MobileProjectFilesContent
      projectId={projectId}
      rootPath={remoteWorkspacePath ?? null}
      remoteAgentId={remoteAgentId}
      hostedWorkspace={hostedWorkspace}
      status={status}
      workspaceSourceLabel={hostedWorkspace ? "Project workspace" : "Remote workspace"}
      workspaceDisplay={remoteWorkspacePath ?? workspacePath ?? null}
      projectName={project?.name ?? "Project"}
      sourceControlAgentInstanceId={localAgentInstanceId ?? remoteAgentInstanceId}
    />
  );
}

function MobileProjectFilesContent({
  projectId,
  rootPath,
  remoteAgentId,
  hostedWorkspace,
  status,
  workspaceSourceLabel,
  workspaceDisplay,
  projectName,
  sourceControlAgentInstanceId,
}: ProjectFilesContentProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedFilePath = searchParams.get("file");
  const activeView = searchParams.get("view") === "changes" ? "changes" : "files";
  const canBrowseWorkspace = Boolean(hostedWorkspace) || (Boolean(rootPath) && Boolean(remoteAgentId));

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

  const selectView = useCallback((view: "files" | "changes") => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (view === "changes") next.set("view", "changes");
      else next.delete("view");
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
            <Text size="lg" weight="medium">Workspace is still loading.</Text>
            <Text size="sm" variant="muted">
              AURA is resolving the active workspace for this project.
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
            <Text size="lg" weight="medium">Workspace data could not load.</Text>
            <Text size="sm" variant="muted">
              AURA could not resolve the live workspace details just now.
            </Text>
          </div>
          <div className={styles.remoteMeta}>
            <Text size="sm" weight="medium">{projectName}</Text>
            <Text size="sm" variant="muted">Waiting for a live workspace.</Text>
          </div>
        </div>
      </div>
    );
  }

  if (!canBrowseWorkspace && activeView === "files") {
    return (
      <div className={styles.remoteRoot}>
        <div className={styles.remoteCard}>
          <div className={styles.remoteHeader}>
            <Text size="xs" variant="muted" className={styles.eyebrow}>Files</Text>
            <Text size="lg" weight="medium">
              Workspace files will appear here when the connected Aura host exposes a live workspace.
            </Text>
            <Text size="sm" variant="muted">
              Once AURA reports the live workspace, you will be able to browse and preview files here.
            </Text>
          </div>
          <div className={styles.remoteMeta}>
            <Text size="sm" weight="medium">{projectName}</Text>
            <Text size="sm" variant="muted">Waiting for a live workspace.</Text>
          </div>
          {sourceControlAgentInstanceId ? (
            <Button variant="secondary" onClick={() => selectView("changes")}>
              Review changes
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (activeView === "files" && selectedFilePath) {
    return (
      <MobileRemoteFilePreview
        filePath={selectedFilePath}
        remoteAgentId={remoteAgentId}
        hostedWorkspace={hostedWorkspace}
        workspaceDisplay={workspaceDisplay}
        onBack={clearSelectedFile}
      />
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.workspaceHeader}>
        <div className={styles.summary}>
          <Text size="sm" weight="medium">{workspaceSourceLabel}</Text>
        </div>
        <div className={styles.viewTabs} role="tablist" aria-label="Workspace view">
          <button
            type="button"
            role="tab"
            aria-selected={activeView === "files"}
            className={`${styles.viewTab}${activeView === "files" ? ` ${styles.viewTabActive}` : ""}`}
            onClick={() => selectView("files")}
          >
            Files
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeView === "changes"}
            className={`${styles.viewTab}${activeView === "changes" ? ` ${styles.viewTabActive}` : ""}`}
            onClick={() => selectView("changes")}
          >
            Changes
          </button>
        </div>
      </div>
      {activeView === "changes" ? (
        <div className={styles.changesArea}>
          <SourceControlWorkbench
            projectId={projectId}
            agentInstanceId={sourceControlAgentInstanceId}
            readOnly
          />
        </div>
      ) : (
        <>
          <div className={styles.searchHeader}>
            <PanelSearch
              placeholder="Search files"
              value={searchQuery}
              onChange={setSearchQuery}
            />
          </div>
          <div className={styles.explorerArea}>
            <FileExplorer
              rootPath={hostedWorkspace ? undefined : rootPath ?? undefined}
              remoteAgentId={remoteAgentId}
              hostedWorkspace={hostedWorkspace}
              rootLabel={hostedWorkspace ? "Project files" : undefined}
              searchQuery={searchQuery}
              onFileSelect={handleFileSelect}
            />
          </div>
        </>
      )}
    </div>
  );
}

function MobileRemoteFilePreview({
  filePath,
  remoteAgentId,
  hostedWorkspace,
  workspaceDisplay,
  onBack,
}: {
  filePath: string;
  remoteAgentId?: string;
  hostedWorkspace?: HostedWorkspaceTarget;
  workspaceDisplay: string | null;
  onBack: () => void;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <MobileRemoteFilePreviewRequest
      key={`${hostedWorkspace ? `hosted:${hostedWorkspace.agentInstanceId}` : `remote:${remoteAgentId}`}:${filePath}:${refreshKey}`}
      filePath={filePath}
      remoteAgentId={remoteAgentId}
      hostedWorkspace={hostedWorkspace}
      workspaceDisplay={workspaceDisplay}
      onBack={onBack}
      onRefresh={() => setRefreshKey((current) => current + 1)}
    />
  );
}

function MobileRemoteFilePreviewRequest({ filePath, remoteAgentId, hostedWorkspace, workspaceDisplay, onBack, onRefresh }: {
  filePath: string;
  remoteAgentId?: string;
  hostedWorkspace?: HostedWorkspaceTarget;
  workspaceDisplay: string | null;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const hostedProjectId = hostedWorkspace?.projectId;
  const hostedAgentInstanceId = hostedWorkspace?.agentInstanceId;
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
    if (!previewSupported) return;

    let cancelled = false;

    const readRequest = hostedProjectId && hostedAgentInstanceId
      ? api.hostedWorkspace.readFile({
          projectId: hostedProjectId,
          agentInstanceId: hostedAgentInstanceId,
        }, filePath)
      : remoteAgentId
        ? api.swarm.readRemoteFile(remoteAgentId, filePath)
        : Promise.reject(new Error("No workspace source available"));

    void readRequest
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
  }, [
    filePath,
    hostedAgentInstanceId,
    hostedProjectId,
    previewSupported,
    remoteAgentId,
  ]);

  return (
    <div className={styles.previewRoot}>
      <div className={styles.previewHeader}>
        <div className={styles.previewHeaderActions}>
          <button type="button" className={styles.inlineBackButton} onClick={onBack}>
            <ArrowLeft size={14} aria-hidden="true" />
            <span>Back to files</span>
          </button>
          {previewSupported ? (
            <Button variant="ghost" size="sm" onClick={onRefresh}>
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
              Mobile preview currently supports text, code, markdown, config, and log files.
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
  return "This workspace file is temporarily unavailable. Try again in a moment.";
}
