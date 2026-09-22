import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Spinner, Text } from "@cypher-asi/zui";
import { ArrowLeft, MessageSquare, RefreshCw } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../../api/client";
import { FileExplorer } from "../../../components/FileExplorer";
import { PanelSearch } from "../../../components/PanelSearch";
import {
  SourceControlWorkbench,
  type SourceControlReviewContext,
} from "../../../components/SourceControlWorkbench";
import { keyForProjectSession } from "../../../hooks/stream/store";
import { useAuraCapabilities } from "../../../hooks/use-aura-capabilities";
import { useTerminalTarget } from "../../../hooks/use-terminal-target";
import type { HostedWorkspaceTarget } from "../../../shared/api/hosted-workspace";
import { useChatUIStore } from "../../../stores/chat-ui-store";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import {
  findMostRecentRealSessionForInstance,
  projectSessionsSurfaceKey,
  useSessionsListStore,
} from "../../../stores/sessions-list-store";
import { getRemoteFileErrorDescription } from "./remote-file-error";
import styles from "./ProjectFilesScreen.module.css";

const MAX_ACTIONABLE_PREVIEW_LINES = 1_000;

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
  conversationAgentId?: string;
  conversationSessionId?: string;
  conversationContextReady: boolean;
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
  const sourceControlAgentInstanceId = localAgentInstanceId ?? remoteAgentInstanceId;
  const explicitConversationSessionId = routeSearchParams.get("session") ?? undefined;
  const sessionsSurfaceKey = projectId ? projectSessionsSurfaceKey(projectId) : null;
  const projectSessions = useSessionsListStore((state) => (
    sessionsSurfaceKey ? state.sessionsBySurface[sessionsSurfaceKey] : undefined
  ));
  const sessionsLoading = useSessionsListStore((state) => (
    sessionsSurfaceKey ? state.loadingBySurface[sessionsSurfaceKey] === true : false
  ));
  const loadProjectSessions = useSessionsListStore((state) => state.loadProjectSessions);
  const inferredConversationSessionId = useMemo(() => (
    findMostRecentRealSessionForInstance(projectSessions, sourceControlAgentInstanceId)?.session_id
  ), [projectSessions, sourceControlAgentInstanceId]);

  useEffect(() => {
    if (
      !projectId ||
      !sourceControlAgentInstanceId ||
      explicitConversationSessionId ||
      projectSessions !== undefined ||
      sessionsLoading
    ) {
      return;
    }
    void loadProjectSessions(projectId, project?.name ?? "Project");
  }, [
    explicitConversationSessionId,
    loadProjectSessions,
    project?.name,
    projectId,
    projectSessions,
    sessionsLoading,
    sourceControlAgentInstanceId,
  ]);

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
      sourceControlAgentInstanceId={sourceControlAgentInstanceId}
      conversationAgentId={routeSearchParams.get("agent") ?? remoteAgentId}
      conversationSessionId={explicitConversationSessionId ?? inferredConversationSessionId}
      conversationContextReady={Boolean(explicitConversationSessionId) || projectSessions !== undefined}
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
  conversationAgentId,
  conversationSessionId,
  conversationContextReady,
}: ProjectFilesContentProps) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedFilePath = searchParams.get("file");
  const activeView = searchParams.get("view") === "changes" ? "changes" : "files";
  const canBrowseWorkspace = Boolean(hostedWorkspace) || (Boolean(rootPath) && Boolean(remoteAgentId));

  const openAgentDraft = useCallback((prompt: string) => {
    if (!sourceControlAgentInstanceId || !conversationContextReady) return;
    const streamKey = keyForProjectSession(
      projectId,
      sourceControlAgentInstanceId,
      conversationSessionId,
    );
    const chatStore = useChatUIStore.getState();
    const currentDraft = chatStore.getDraft(streamKey).trimEnd();
    chatStore.setDraft(
      streamKey,
      currentDraft ? `${currentDraft}\n\n${prompt}` : prompt,
    );

    const params = new URLSearchParams({
      project: projectId,
      instance: sourceControlAgentInstanceId,
    });
    if (conversationSessionId) params.set("session", conversationSessionId);
    if (conversationAgentId) {
      navigate(
        `/agents/${encodeURIComponent(conversationAgentId)}?${params.toString()}`,
      );
      return;
    }
    const sessionQuery = conversationSessionId
      ? `?session=${encodeURIComponent(conversationSessionId)}`
      : "";
    navigate(
      `/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(sourceControlAgentInstanceId)}${sessionQuery}`,
    );
  }, [
    conversationAgentId,
    conversationContextReady,
    conversationSessionId,
    navigate,
    projectId,
    sourceControlAgentInstanceId,
  ]);

  const discussChanges = useCallback(() => {
    openAgentDraft(
      "Please review the current workspace changes. Call out risks, regressions, and missing tests before suggesting the next step.",
    );
  }, [openAgentDraft]);

  const discussChangedLine = useCallback((context: SourceControlReviewContext) => {
    const location = context.newLine !== null
      ? `new line ${context.newLine}`
      : `old line ${context.oldLine}`;
    const boundedLine = context.line.slice(0, 500);
    openAgentDraft(
      `Please review \`${context.path}\` (${context.area}, ${location}) and inspect the surrounding code before responding.\n\n\`\`\`diff\n${boundedLine}\n\`\`\``,
    );
  }, [openAgentDraft]);

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
        onAskAgent={(filePath) => {
          openAgentDraft(
            `Please help me with \`${filePath}\` in this workspace. Inspect the file and related code before recommending or making changes.`,
          );
        }}
        onAskAgentLine={(filePath, lineNumber, line) => {
          const boundedLine = line.slice(0, 500);
          openAgentDraft(
            `Please review \`${filePath}\` (line ${lineNumber}) and inspect the surrounding code before responding.\n\n\`\`\`code\n${boundedLine}\n\`\`\``,
          );
        }}
        askAgentDisabled={!conversationContextReady}
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
        <>
          {sourceControlAgentInstanceId ? (
            <div className={styles.agentHandoffBar}>
              <Button
                variant="secondary"
                size="sm"
                disabled={!conversationContextReady}
                onClick={discussChanges}
              >
                <MessageSquare size={14} aria-hidden="true" />
                Ask agent to review changes
              </Button>
            </div>
          ) : null}
          <div className={styles.changesArea}>
            <SourceControlWorkbench
              projectId={projectId}
              agentInstanceId={sourceControlAgentInstanceId}
              remoteAgentId={hostedWorkspace ? undefined : remoteAgentId}
              remoteWorkspacePath={hostedWorkspace ? undefined : rootPath ?? undefined}
              readOnly
              onDiscussChange={conversationContextReady ? discussChangedLine : undefined}
            />
          </div>
        </>
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
  onAskAgent,
  onAskAgentLine,
  askAgentDisabled,
}: {
  filePath: string;
  remoteAgentId?: string;
  hostedWorkspace?: HostedWorkspaceTarget;
  workspaceDisplay: string | null;
  onBack: () => void;
  onAskAgent: (filePath: string) => void;
  onAskAgentLine: (filePath: string, lineNumber: number, line: string) => void;
  askAgentDisabled: boolean;
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
      onAskAgent={onAskAgent}
      onAskAgentLine={onAskAgentLine}
      askAgentDisabled={askAgentDisabled}
    />
  );
}

function MobileRemoteFilePreviewRequest({ filePath, remoteAgentId, hostedWorkspace, workspaceDisplay, onBack, onRefresh, onAskAgent, onAskAgentLine, askAgentDisabled }: {
  filePath: string;
  remoteAgentId?: string;
  hostedWorkspace?: HostedWorkspaceTarget;
  workspaceDisplay: string | null;
  onBack: () => void;
  onRefresh: () => void;
  onAskAgent: (filePath: string) => void;
  onAskAgentLine: (filePath: string, lineNumber: number, line: string) => void;
  askAgentDisabled: boolean;
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
  const previewLines = useMemo(() => state.content?.split("\n") ?? null, [state.content]);
  const actionablePreviewLines = previewLines !== null
    && previewLines.length <= MAX_ACTIONABLE_PREVIEW_LINES
    ? previewLines
    : null;

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
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ loading: false, content: null, error: getRemoteFileErrorDescription(error) });
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
        <Button
          variant="secondary"
          size="sm"
          disabled={askAgentDisabled}
          onClick={() => onAskAgent(filePath)}
        >
          <MessageSquare size={14} aria-hidden="true" />
          Ask agent about this file
        </Button>
      </div>
      <div className={styles.previewBody}>
        <div className={styles.previewPath}>
          <Text size="xs" variant="muted">{filePath}</Text>
          {!askAgentDisabled && actionablePreviewLines ? (
            <Text size="xs" variant="muted">Tap a source line to ask the agent about it.</Text>
          ) : null}
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
        ) : actionablePreviewLines ? (
          <pre className={styles.previewContent}>
            <code>
              {actionablePreviewLines.map((line, index) => (
                <button
                  type="button"
                  className={styles.previewLine}
                  key={index}
                  disabled={askAgentDisabled}
                  onClick={() => onAskAgentLine(filePath, index + 1, line)}
                  aria-label={`Ask agent about ${filePath} line ${index + 1}`}
                >
                  <span className={styles.previewLineNumber} aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className={styles.previewLineCode}>{line || " "}</span>
                </button>
              ))}
            </code>
          </pre>
        ) : (
          <pre className={`${styles.previewContent} ${styles.previewContentPlain}`}>
            {state.content ?? ""}
          </pre>
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
