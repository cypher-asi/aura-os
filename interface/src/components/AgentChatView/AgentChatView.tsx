import { useCallback, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
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
import type { AgentInstance, Project } from "../../types";

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

function StandaloneAgentChatPanel({ agentId }: { agentId: string }) {
  const agentProjects = useProjectsListStore(useShallow(selectProjectsForAgent(agentId)));
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(() =>
    loadPersistedProject(agentId),
  );
  const { streamKey, sendMessage, stopStreaming, resetEvents } = useAgentChatStream({ agentId });
  const { agentName, machineType, templateAgentId, adapterType, defaultModel } = useAgentChatMeta(
    "agent",
    { agentId },
  );
  const { setSelectedAgent } = useSelectedAgent();

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
      key={agentId}
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
      scrollResetKey={agentId}
      historyMessages={historyMessages}
      projects={agentProjects}
      selectedProjectId={effectiveProjectId}
      onProjectChange={handleProjectChange}
    />
  );
}

function ProjectAgentChatPanel({
  projectId,
  agentInstanceId,
  sessionId,
  onExitSessionView,
}: {
  projectId: string;
  agentInstanceId: string;
  sessionId: string | null;
  onExitSessionView: () => void;
}) {
  const isSessionView = !!sessionId;
  const currentProject = useProjectsListStore(useShallow(selectCurrentProject(projectId)));
  const { streamKey, sendMessage, stopStreaming, resetEvents } = useChatStream({
    projectId,
    agentInstanceId,
  });
  const { agentName, machineType, templateAgentId, adapterType, defaultModel } = useAgentChatMeta(
    "project",
    { projectId, agentInstanceId },
  );

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

  const { historyResolved, isLoading, historyError, wrapSend } = useChatHistorySync({
    historyKey,
    streamKey,
    fetchFn,
    resetEvents,
    invalidateBeforeFetch: isSessionView,
    onSwitch: onProjectSwitch,
    onClear,
  });

  const wrappedSend = useMemo(() => wrapSend(sendMessage), [wrapSend, sendMessage]);
  const deferredLoading = useDelayedLoading(isLoading);
  const panelKey = isSessionView ? `${agentInstanceId}:${sessionId}` : agentInstanceId;

  return (
    <>
      {isSessionView && <SessionBanner onExit={onExitSessionView} />}
      <ChatPanel
        key={panelKey}
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
        scrollResetKey={panelKey}
        projects={currentProject}
        selectedProjectId={projectId}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

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
      />
    );
  }

  if (agentId) {
    return <StandaloneAgentChatPanel agentId={agentId} />;
  }

  return null;
}
