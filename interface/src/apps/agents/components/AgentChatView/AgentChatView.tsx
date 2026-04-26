import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { X } from "lucide-react";
import { Drawer, Modal } from "@cypher-asi/zui";
import { api, STANDALONE_AGENT_HISTORY_LIMIT } from "../../../../api/client";
import { useAgentChatStream } from "../../../../hooks/use-agent-chat-stream";
import { useChatStream } from "../../../../hooks/use-chat-stream";
import { useChatHistorySync } from "../../../../hooks/use-chat-history-sync";
import { useDelayedLoading } from "../../../../shared/hooks/use-delayed-loading";
import { useAgentChatMeta } from "../../../../hooks/use-agent-chat-meta";
import { setLastAgent, setLastProject } from "../../../../utils/storage";
import { ChatPanel } from "../../../chat/components/ChatPanel";
import {
  projectChatHistoryKey,
  agentHistoryKey,
} from "../../../../stores/chat-history-store";
import { useSelectedAgent, LAST_AGENT_ID_KEY } from "../../stores";
import { useProjectsListStore } from "../../../../stores/projects-list-store";
import { queryClient } from "../../../../shared/lib/query-client";
import { deriveProjectAgentTitle } from "../../../../lib/derive-project-agent-title";
import { mergeAgentIntoProjectAgents, projectQueryKeys } from "../../../../queries/project-queries";
import { useChatHandoffStore } from "../../../../stores/chat-handoff-store";
import { useContextUsage, useContextUsageStore } from "../../../../stores/context-usage-store";
import { useHydrateContextUtilization } from "../../../../hooks/use-hydrate-context-utilization";
import type { AgentInstance, Project } from "../../../../shared/types";
import {
  isCreateAgentChatHandoff,
  projectAgentHandoffTarget,
  standaloneAgentHandoffTarget,
} from "../../../../utils/chat-handoff";
import { useAuraCapabilities } from "../../../../hooks/use-aura-capabilities";
import { useAgentBusy } from "../../../../hooks/use-agent-busy";
import styles from "./AgentChatView.module.css";

const AGENT_PROJECT_KEY_PREFIX = "aura-agent-project:";
const EMPTY_PROJECTS: Project[] = [];
const EMPTY_AGENT_INSTANCES: AgentInstance[] = [];

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
  const { streamKey, sendMessage, stopStreaming, resetEvents, markNextSendAsNewSession } = useAgentChatStream({ agentId });
  const { agentName, machineType, templateAgentId, adapterType, defaultModel } = useAgentChatMeta(
    "agent",
    { agentId },
  );
  const { setSelectedAgent } = useSelectedAgent();
  const contextUsage = useContextUsage(streamKey);

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
    markNextSendAsNewSession();
    const store = useContextUsageStore.getState();
    store.clearContextUtilization(streamKey);
    store.markResetPending(streamKey);
  }, [agentId, markNextSendAsNewSession, streamKey]);

  const contextUsageFetcher = useMemo(
    () =>
      (signal: AbortSignal) => api.agents.getContextUsage(agentId, { signal }),
    [agentId],
  );
  useHydrateContextUtilization(streamKey, contextUsageFetcher, agentId);

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
      initialHandoff={initialCreateHandoff ? "create-agent" : undefined}
      onInitialHandoffReady={onInitialHandoffReady}
      scrollResetKey={agentId}
      historyMessages={historyMessages}
      projects={agentProjects}
      selectedProjectId={effectiveProjectId}
      onProjectChange={handleProjectChange}
      contextUsage={contextUsage}
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
  const navigate = useNavigate();
  const { isMobileLayout } = useAuraCapabilities();
  const currentProject = useProjectsListStore(useShallow(selectCurrentProject(projectId)));
  const projectAgents = useProjectsListStore((state) => state.agentsByProject[projectId] ?? EMPTY_AGENT_INSTANCES);
  const setAgentsByProject = useProjectsListStore((state) => state.setAgentsByProject);
  const { streamKey, sendMessage, stopStreaming, resetEvents, markNextSendAsNewSession } = useChatStream({
    projectId,
    agentInstanceId,
  });
  const { agentName, machineType, templateAgentId, adapterType, defaultModel } = useAgentChatMeta(
    "project",
    { projectId, agentInstanceId },
  );
  const contextUsage = useContextUsage(streamKey);

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
    markNextSendAsNewSession();
    const store = useContextUsageStore.getState();
    store.clearContextUtilization(streamKey);
    store.markResetPending(streamKey);
  }, [projectId, agentInstanceId, markNextSendAsNewSession, streamKey]);

  const contextUsageFetcher = useMemo(() => {
    if (isSessionView) return undefined;
    return (signal: AbortSignal) =>
      api.getContextUsage(projectId, agentInstanceId, { signal });
  }, [isSessionView, projectId, agentInstanceId]);
  useHydrateContextUtilization(
    streamKey,
    contextUsageFetcher,
    isSessionView ? undefined : agentInstanceId,
  );

  const { historyMessages, historyResolved, isLoading, historyError, wrapSend } = useChatHistorySync({
    historyKey,
    streamKey,
    fetchFn,
    resetEvents,
    invalidateBeforeFetch: isSessionView,
    onSwitch: onProjectSwitch,
    onClear,
    watchAgentInstanceId: agentInstanceId,
    watchSessionId: sessionId ?? undefined,
    projectIdForSidekick: projectId,
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

  // Combine our own chat-SSE streaming state with automation-loop
  // activity against the same upstream agent so the chat input shows
  // the stop icon (and blocks Send) whenever the harness would reject
  // a new turn. The harness enforces one in-flight turn per agent id
  // upstream — see `/v1/agents/{id}/sessions` vs
  // `/v1/agents/{id}/automaton/start` in the server.
  const busy = useAgentBusy({ projectId, agentInstanceId, streamKey });
  const loopOnlyBusy = busy.isBusy && busy.reason === "loop";
  const handleCombinedStop = useCallback(() => {
    if (loopOnlyBusy) {
      void api.stopLoop(projectId, agentInstanceId).catch((err) => {
        console.error("Failed to stop automation loop from chat", err);
      });
      return;
    }
    stopStreaming();
  }, [loopOnlyBusy, projectId, agentInstanceId, stopStreaming]);

  const deferredLoading = useDelayedLoading(isLoading);
  const panelKey = isSessionView ? `${agentInstanceId}:${sessionId}` : agentInstanceId;
  const shouldUseCreateHandoff = initialCreateHandoff && !isSessionView;
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const showAgentSwitcher = !isSessionView && projectAgents.length > 1;
  const mobileHeaderSummaryHint = agentName ? (showAgentSwitcher ? `${projectAgents.length} agents in project` : machineType === "remote"
    ? "Remote"
    : "Local") : undefined;
  const openAgentPicker = useCallback(() => {
    setAgentPickerOpen(true);
  }, []);
  const closeAgentPicker = useCallback(() => {
    setAgentPickerOpen(false);
  }, []);
  const switchProjectAgent = useCallback((nextAgentInstanceId: string) => {
    setAgentPickerOpen(false);
    setLastProject(projectId);
    setLastAgent(projectId, nextAgentInstanceId);
    navigate(`/projects/${projectId}/agents/${nextAgentInstanceId}`);
  }, [navigate, projectId]);
  const agentPickerContent = (
    <div className={styles.mobileAgentSwitcherBody}>
      <div className={styles.mobileAgentSwitcherHeader}>
        <span className={styles.mobileAgentSwitcherName}>Project agents</span>
        <span className={styles.mobileAgentSwitcherMeta}>Switch who you are chatting with.</span>
      </div>
      <div className={styles.mobileAgentSwitcherList}>
        {projectAgents.map((agent) => {
          const isCurrentAgent = agent.agent_instance_id === agentInstanceId;
          return (
            <button
              key={agent.agent_instance_id}
              type="button"
              className={`${styles.mobileAgentSwitcherRow} ${isCurrentAgent ? styles.mobileAgentSwitcherRowCurrent : ""}`}
              onClick={() => {
                if (isCurrentAgent) {
                  return;
                }
                switchProjectAgent(agent.agent_instance_id);
              }}
              aria-label={isCurrentAgent ? `${agent.name}, current agent` : `Switch to ${agent.name}`}
              disabled={isCurrentAgent}
            >
              <span className={styles.mobileAgentSwitcherCopy}>
                <span className={styles.mobileAgentSwitcherName}>{agent.name}</span>
                <span className={styles.mobileAgentSwitcherMeta}>{agent.role?.trim() || "Remote AURA agent"}</span>
              </span>
              {isCurrentAgent ? <span className={styles.mobileAgentSwitcherStatus}>Current</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      {isSessionView && <SessionBanner onExit={onExitSessionView} />}
      <ChatPanel
        streamKey={streamKey}
        onSend={isSessionView ? noopSend : wrappedSend}
        onStop={handleCombinedStop}
        isExternallyBusy={loopOnlyBusy}
        externalBusyMessage={
          loopOnlyBusy
            ? "This agent is running an automation task. Stop it to chat."
            : undefined
        }
        agentName={agentName}
        machineType={machineType}
        templateAgentId={templateAgentId}
        adapterType={adapterType}
        defaultModel={defaultModel}
        agentId={agentInstanceId}
        isLoading={deferredLoading}
        historyResolved={historyResolved}
        errorMessage={historyError ? historyError : null}
        initialHandoff={shouldUseCreateHandoff ? "create-agent" : undefined}
        onInitialHandoffReady={onInitialHandoffReady}
        scrollResetKey={panelKey}
        historyMessages={historyMessages}
        projects={currentProject}
        selectedProjectId={projectId}
        contextUsage={isSessionView ? undefined : contextUsage}
        onNewSession={isSessionView ? undefined : handleNewSession}
        onMobileHeaderSummaryClick={showAgentSwitcher ? openAgentPicker : undefined}
        mobileHeaderSummaryHint={mobileHeaderSummaryHint}
        mobileHeaderSummaryLabel="Switch project agent"
        mobileHeaderSummaryKind={showAgentSwitcher ? "switch" : "details"}
      />
      {agentPickerOpen
        ? (isMobileLayout ? (
          <Drawer
            side="bottom"
            isOpen
            onClose={closeAgentPicker}
            title="Switch agent"
            className={styles.mobileAgentSwitcher}
            showMinimizedBar={false}
            defaultSize={360}
            maxSize={520}
          >
            {agentPickerContent}
          </Drawer>
        ) : (
          <Modal
            isOpen
            onClose={closeAgentPicker}
            title="Switch agent"
            size="sm"
          >
            {agentPickerContent}
          </Modal>
        ))
        : null}
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
