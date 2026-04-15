import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { X } from "lucide-react";
import { api, STANDALONE_AGENT_HISTORY_LIMIT } from "../../api/client";
import { useAgentChatStream } from "../../hooks/use-agent-chat-stream";
import { useChatStream } from "../../hooks/use-chat-stream";
import { useChatHistorySync } from "../../hooks/use-chat-history-sync";
import { useDelayedLoading } from "../../hooks/use-delayed-loading";
import { useAgentChatMeta } from "../../hooks/use-agent-chat-meta";
import { setLastAgent, setLastProject } from "../../utils/storage";
import { ChatPanel } from "../ChatPanel";
import { projectChatHistoryKey, agentHistoryKey } from "../../stores/chat-history-store";
import { useSelectedAgent, LAST_AGENT_ID_KEY } from "../../apps/agents/stores";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { queryClient } from "../../lib/query-client";
import { deriveProjectAgentTitle } from "../../lib/derive-project-agent-title";
import { mergeAgentIntoProjectAgents, projectQueryKeys } from "../../queries/project-queries";
import { useChatHandoffStore } from "../../stores/chat-handoff-store";
import { useContextUtilization, useContextUsageStore } from "../../stores/context-usage-store";
import type { AgentInstance, Project } from "../../types";
import {
  isCreateAgentChatHandoff,
  projectAgentHandoffTarget,
  standaloneAgentHandoffTarget,
} from "../../utils/chat-handoff";

const AGENT_PROJECT_KEY_PREFIX = "aura-agent-project:";
const EMPTY_PROJECTS: Project[] = [];

function loadPersistedProject(agentId: string): string | undefined {
  try {
    return localStorage.getItem(`${AGENT_PROJECT_KEY_PREFIX}${agentId}`) ?? undefined;
  } catch {
    return undefined;
  }
}

function persistAgentProject(agentId: string, projectId: string) {
  try {
    localStorage.setItem(`${AGENT_PROJECT_KEY_PREFIX}${agentId}`, projectId);
  } catch { /* ignore */ }
}

const noopSend = () => {};

function selectProjectsForAgent(agentId: string) {
  return (state: { projects: Project[]; agentsByProject: Record<string, AgentInstance[]> }) => {
    return state.projects.filter((project) => {
      const instances = state.agentsByProject[project.project_id];
      return instances?.some((instance) => instance.agent_id === agentId);
    });
  };
}

function selectCurrentProject(projectId: string) {
  return (state: { projects: Project[] }) => {
    const project = state.projects.find((candidate) => candidate.project_id === projectId);
    return project ? [project] : EMPTY_PROJECTS;
  };
}

function SessionBanner({ onExit }: { onExit: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        background: "var(--color-bg-hover)",
        borderBottom: "1px solid var(--color-border)",
        fontSize: 12,
        color: "var(--color-text-secondary)",
      }}
    >
      <span>Viewing historical session</span>
      <button
        type="button"
        onClick={onExit}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          marginLeft: "auto",
          background: "none",
          border: "none",
          color: "var(--color-text-secondary)",
          cursor: "pointer",
          padding: "2px 6px",
          borderRadius: 4,
          fontSize: 12,
        }}
      >
        Back to live <X size={12} />
      </button>
    </div>
  );
}

function StandaloneAgentChatPanel({
  agentId,
  initialCreateHandoff,
  onInitialHandoffReady,
}: {
  agentId: string;
  initialCreateHandoff: boolean;
  onInitialHandoffReady?: () => void;
}) {
  const agentProjects = useProjectsListStore(useShallow(selectProjectsForAgent(agentId)));
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(() =>
    loadPersistedProject(agentId),
  );
  useEffect(() => {
    setSelectedProjectId(loadPersistedProject(agentId));
  }, [agentId]);
  const { streamKey, sendMessage, stopStreaming, resetEvents } = useAgentChatStream({ agentId });
  const { agentName, machineType, templateAgentId, adapterType, defaultModel } = useAgentChatMeta(
    "agent",
    { agentId },
  );
  const { setSelectedAgent } = useSelectedAgent();
  const contextUtilization = useContextUtilization(streamKey);

  const effectiveProjectId = useMemo(() => {
    if (selectedProjectId && agentProjects.some((project) => project.project_id === selectedProjectId)) {
      return selectedProjectId;
    }
    return agentProjects[0]?.project_id;
  }, [agentProjects, selectedProjectId]);

  const handleProjectChange = useCallback(
    (projectId: string) => {
      setSelectedProjectId(projectId);
      persistAgentProject(agentId, projectId);
    },
    [agentId],
  );

  const historyKey = useMemo(() => agentHistoryKey(agentId), [agentId]);
  const fetchFn = useMemo(
    () => () =>
      api.agents.listEvents(agentId, {
        limit: STANDALONE_AGENT_HISTORY_LIMIT,
      }),
    [agentId],
  );

  const onAgentSwitch = useCallback(() => {
    setSelectedAgent(agentId);
    localStorage.setItem(LAST_AGENT_ID_KEY, agentId);
  }, [agentId, setSelectedAgent]);

  const onClear = useCallback(() => {
    resetEvents([], { allowWhileStreaming: true });
  }, [resetEvents]);

  const handleNewSession = useCallback(() => {
    api.agents.resetSession(agentId).catch(() => {});
    useContextUsageStore.getState().clearContextUtilization(streamKey);
    resetEvents([], { allowWhileStreaming: true });
  }, [agentId, streamKey, resetEvents]);

  const { historyMessages, historyResolved, isLoading, historyError, wrapSend } =
    useChatHistorySync({
    historyKey,
    streamKey,
    fetchFn,
    resetEvents,
    invalidateBeforeFetch: false,
    onSwitch: onAgentSwitch,
    onClear,
      hydrateToStream: false,
    });

  const wrappedSend = useMemo(() => wrapSend(sendMessage), [wrapSend, sendMessage]);
  const deferredLoading = useDelayedLoading(isLoading);

  return (
    <ChatPanel
      streamKey={streamKey}
      onSend={wrappedSend}
      onStop={stopStreaming}
      agentName={agentName}
      machineType={machineType}
      templateAgentId={templateAgentId}
      adapterType={adapterType}
      defaultModel={defaultModel}
      agentId={agentId}
      isLoading={deferredLoading}
      historyResolved={historyResolved}
      errorMessage={historyError ? historyError : null}
      emptyMessage="Send a message"
      initialHandoff={initialCreateHandoff ? "create-agent" : undefined}
      onInitialHandoffReady={onInitialHandoffReady}
      scrollResetKey={agentId}
      historyMessages={historyMessages}
      projects={agentProjects}
      selectedProjectId={effectiveProjectId}
      onProjectChange={handleProjectChange}
      contextUtilization={contextUtilization}
      onNewSession={handleNewSession}
    />
  );
}

function ProjectAgentChatPanel({
  projectId,
  agentInstanceId,
  sessionId,
  onExitSessionView,
  initialCreateHandoff,
  onInitialHandoffReady,
}: {
  projectId: string;
  agentInstanceId: string;
  sessionId: string | null;
  onExitSessionView: () => void;
  initialCreateHandoff: boolean;
  onInitialHandoffReady?: () => void;
}) {
  const isSessionView = !!sessionId;
  const currentProject = useProjectsListStore(useShallow(selectCurrentProject(projectId)));
  const setAgentsByProject = useProjectsListStore((state) => state.setAgentsByProject);
  const { streamKey, sendMessage, stopStreaming, resetEvents } = useChatStream({
    projectId,
    agentInstanceId,
  });
  const { agentName, machineType, templateAgentId, adapterType, defaultModel } = useAgentChatMeta(
    "project",
    { projectId, agentInstanceId },
  );
  const contextUtilization = useContextUtilization(streamKey);

  const historyKey = useMemo(() => {
    if (sessionId) {
      return `session:${projectId}:${agentInstanceId}:${sessionId}`;
    }
    return projectChatHistoryKey(projectId, agentInstanceId);
  }, [agentInstanceId, projectId, sessionId]);

  const fetchFn = useMemo(() => {
    if (sessionId) {
      return () => api.listSessionEvents(projectId, agentInstanceId, sessionId);
    }
    return () => api.getEvents(projectId, agentInstanceId);
  }, [agentInstanceId, projectId, sessionId]);

  const onProjectSwitch = useCallback(() => {
    setLastProject(projectId);
    setLastAgent(projectId, agentInstanceId);
  }, [agentInstanceId, projectId]);

  const onClear = useCallback(() => {
    resetEvents([], { allowWhileStreaming: true });
  }, [resetEvents]);

  const handleNewSession = useCallback(() => {
    api.resetInstanceSession(projectId, agentInstanceId).catch(() => {});
    useContextUsageStore.getState().clearContextUtilization(streamKey);
    resetEvents([], { allowWhileStreaming: true });
  }, [projectId, agentInstanceId, streamKey, resetEvents]);

  const { historyMessages, historyResolved, isLoading, historyError, wrapSend } = useChatHistorySync({
    historyKey,
    streamKey,
    fetchFn,
    resetEvents,
    invalidateBeforeFetch: isSessionView,
    onSwitch: onProjectSwitch,
    onClear,
  });

  const hasHistory = historyMessages.length > 0;
  const renameTriggeredRef = useRef(false);
  useEffect(() => {
    renameTriggeredRef.current = false;
  }, [agentInstanceId, sessionId]);

  const wrappedSendBase = useMemo(() => wrapSend(sendMessage), [wrapSend, sendMessage]);
  const maybeRenameFromFirstPrompt = useCallback((content: string) => {
    if (renameTriggeredRef.current || isSessionView || agentName !== "New Agent") {
      return;
    }
    if (hasHistory) {
      return;
    }

    const nextName = deriveProjectAgentTitle(content);
    if (!nextName || nextName === "New Agent") {
      return;
    }

    renameTriggeredRef.current = true;
    void api.updateAgentInstance(projectId, agentInstanceId, { name: nextName })
      .then((updated) => {
        queryClient.setQueryData(
          projectQueryKeys.agentInstance(projectId, agentInstanceId),
          updated,
        );
        setAgentsByProject((prev) => ({
          ...prev,
          [projectId]: mergeAgentIntoProjectAgents(prev[projectId], updated),
        }));
      })
      .catch((error) => {
        renameTriggeredRef.current = false;
        console.error("Failed to rename project agent from first prompt", error);
      });
  }, [
    agentInstanceId,
    agentName,
    hasHistory,
    isSessionView,
    projectId,
    setAgentsByProject,
  ]);
  const wrappedSend = useCallback((...args: Parameters<typeof wrappedSendBase>) => {
    maybeRenameFromFirstPrompt(args[0] ?? "");
    return wrappedSendBase(...args);
  }, [maybeRenameFromFirstPrompt, wrappedSendBase]);
  const deferredLoading = useDelayedLoading(isLoading);
  const panelKey = isSessionView ? `${agentInstanceId}:${sessionId}` : agentInstanceId;
  const shouldUseCreateHandoff = initialCreateHandoff && !isSessionView;

  return (
    <>
      {isSessionView && <SessionBanner onExit={onExitSessionView} />}
      <ChatPanel
        streamKey={streamKey}
        onSend={isSessionView ? noopSend : wrappedSend}
        onStop={stopStreaming}
        agentName={agentName}
        machineType={machineType}
        templateAgentId={templateAgentId}
        adapterType={adapterType}
        defaultModel={defaultModel}
        agentId={agentInstanceId}
        isLoading={deferredLoading}
        historyResolved={historyResolved}
        errorMessage={historyError ? historyError : null}
        emptyMessage={isSessionView ? "No events in this session" : undefined}
        initialHandoff={shouldUseCreateHandoff ? "create-agent" : undefined}
        onInitialHandoffReady={onInitialHandoffReady}
        scrollResetKey={panelKey}
        historyMessages={historyMessages}
        projects={currentProject}
        selectedProjectId={projectId}
        contextUtilization={isSessionView ? undefined : contextUtilization}
        onNewSession={isSessionView ? undefined : handleNewSession}
      />
    </>
  );
}

export function AgentChatView() {
  const { projectId, agentInstanceId, agentId } = useParams<{
    projectId: string;
    agentInstanceId: string;
    agentId: string;
  }>();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionId = searchParams.get("session");
  const isCreateHandoff = isCreateAgentChatHandoff(location.state);
  const completeCreateAgentHandoff = useChatHandoffStore((state) => state.completeCreateAgentHandoff);

  const handleProjectHandoffReady = useCallback(() => {
    if (!projectId || !agentInstanceId) {
      return;
    }
    completeCreateAgentHandoff(projectAgentHandoffTarget(projectId, agentInstanceId));
  }, [agentInstanceId, completeCreateAgentHandoff, projectId]);

  const handleStandaloneHandoffReady = useCallback(() => {
    if (!agentId) {
      return;
    }
    completeCreateAgentHandoff(standaloneAgentHandoffTarget(agentId));
  }, [agentId, completeCreateAgentHandoff]);

  const exitSessionView = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("session");
      return next;
    });
  }, [setSearchParams]);

  if (projectId && agentInstanceId) {
    return (
      <ProjectAgentChatPanel
        projectId={projectId}
        agentInstanceId={agentInstanceId}
        sessionId={sessionId}
        onExitSessionView={exitSessionView}
        initialCreateHandoff={isCreateHandoff}
        onInitialHandoffReady={isCreateHandoff ? handleProjectHandoffReady : undefined}
      />
    );
  }

  if (agentId) {
    return (
      <StandaloneAgentChatPanel
        agentId={agentId}
        initialCreateHandoff={isCreateHandoff}
        onInitialHandoffReady={isCreateHandoff ? handleStandaloneHandoffReady : undefined}
      />
    );
  }

  return null;
}
