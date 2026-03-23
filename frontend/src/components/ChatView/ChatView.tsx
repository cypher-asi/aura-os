import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Bot, ChevronDown } from "lucide-react";
import { api } from "../../api/client";
import { useChatStream } from "../../hooks/use-chat-stream";
import { useIsStreaming } from "../../hooks/stream/hooks";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useDelayedLoading } from "../../hooks/use-delayed-loading";
import { setLastAgent, setLastProject } from "../../utils/storage";
import { projectAgentChatRoute } from "../../utils/mobileNavigation";
import { ChatPanel } from "../ChatPanel";
import { useChatHistoryStore, useChatHistory, projectChatHistoryKey } from "../../stores/chat-history-store";
import { useProjectsListStore } from "../../stores/projects-list-store";
import styles from "./ChatView.module.css";

const EMPTY_PROJECT_AGENTS: readonly [] = [];

export function ChatView() {
  const navigate = useNavigate();
  const { projectId, agentInstanceId } = useParams<{
    projectId: string;
    agentInstanceId: string;
  }>();
  const { isMobileLayout } = useAuraCapabilities();
  const projectAgents = useProjectsListStore((state) => (
    projectId ? state.agentsByProject[projectId] ?? EMPTY_PROJECT_AGENTS : EMPTY_PROJECT_AGENTS
  ));
  const isLoadingProjectAgents = useProjectsListStore((state) => (
    projectId ? Boolean(state.loadingAgentsByProject[projectId]) : false
  ));
  const refreshProjectAgents = useProjectsListStore((state) => state.refreshProjectAgents);

  const historyKey = projectId && agentInstanceId
    ? projectChatHistoryKey(projectId, agentInstanceId)
    : undefined;

  const { messages: historyMessages, status: historyStatus } = useChatHistory(historyKey);

  const {
    streamKey,
    sendMessage,
    stopStreaming,
    resetMessages,
  } = useChatStream({ projectId, agentInstanceId });
  const isStreaming = useIsStreaming(streamKey);

  const [agentName, setAgentName] = useState<string | undefined>();
  const [contextUsagePercent, setContextUsagePercent] = useState<number | null>(null);

  const metadataLoadIdRef = useRef(0);
  const resetMessagesRef = useRef(resetMessages);
  useEffect(() => { resetMessagesRef.current = resetMessages; }, [resetMessages]);

  const selectedProjectAgent = projectAgents.find((agent) => agent.agent_instance_id === agentInstanceId) ?? null;

  useEffect(() => {
    if (!projectId) return;
    if (projectAgents.length > 0 || isLoadingProjectAgents) return;
    void refreshProjectAgents(projectId).catch(() => {});
  }, [isLoadingProjectAgents, projectAgents.length, projectId, refreshProjectAgents]);

  useEffect(() => {
    const loadId = ++metadataLoadIdRef.current;
    const controller = new AbortController();

    if (projectId && agentInstanceId) {
      setAgentName(undefined);
      setLastProject(projectId);
      setLastAgent(projectId, agentInstanceId);
      api
        .getAgentInstance(projectId, agentInstanceId, { signal: controller.signal })
        .then((inst) => {
          if (loadId === metadataLoadIdRef.current) setAgentName(inst.name);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
        });
    } else {
      setAgentName(undefined);
    }

    return () => { controller.abort(); };
  }, [projectId, agentInstanceId]);

  const fetchActiveSessionContext = useCallback(async () => {
    if (!projectId || !agentInstanceId) return null;
    try {
      const sessions = await api.listSessions(projectId, agentInstanceId);
      const active = sessions.find((session) => session.status === "active");
      if (active != null && typeof active.context_usage_estimate === "number") {
        return Math.round(active.context_usage_estimate * 100);
      }
    } catch {
      // ignore
    }
    return null;
  }, [projectId, agentInstanceId]);

  useEffect(() => {
    let cancelled = false;
    void fetchActiveSessionContext().then((percent) => {
      if (!cancelled) setContextUsagePercent(percent);
    });
    return () => { cancelled = true; };
  }, [fetchActiveSessionContext]);

  const prevIsStreamingRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    if (prevIsStreamingRef.current && !isStreaming) {
      void fetchActiveSessionContext().then((percent) => {
        if (!cancelled) setContextUsagePercent(percent);
      });
      if (historyKey) {
        useChatHistoryStore.getState().invalidateHistory(historyKey);
      }
    }
    prevIsStreamingRef.current = isStreaming;
    return () => { cancelled = true; };
  }, [isStreaming, fetchActiveSessionContext, historyKey]);

  useEffect(() => {
    if (!projectId || !agentInstanceId) {
      queueMicrotask(() => {
        resetMessagesRef.current([], { allowWhileStreaming: true });
        setContextUsagePercent(null);
      });
      return;
    }

    const key = projectChatHistoryKey(projectId, agentInstanceId);
    useChatHistoryStore.getState().fetchHistory(
      key,
      () => api.getMessages(projectId, agentInstanceId),
    );
  }, [projectId, agentInstanceId]);

  useEffect(() => {
    if (historyStatus !== "ready") return;
    resetMessagesRef.current(historyMessages, { allowWhileStreaming: true });
  }, [historyMessages, historyStatus]);

  const wrappedSend = useCallback(
    (...args: Parameters<typeof sendMessage>) => {
      if (historyKey) {
        useChatHistoryStore.getState().invalidateHistory(historyKey);
      }
      return sendMessage(...args);
    },
    [sendMessage, historyKey],
  );

  const handleProjectAgentChange = useCallback((nextAgentInstanceId: string) => {
    if (!projectId || !nextAgentInstanceId || nextAgentInstanceId === agentInstanceId) return;
    navigate(projectAgentChatRoute(projectId, nextAgentInstanceId));
  }, [agentInstanceId, navigate, projectId]);

  const rawLoading = historyStatus === "loading" || historyStatus === "idle";
  const deferredLoading = useDelayedLoading(rawLoading);
  const historyResolved = historyStatus === "ready" || historyStatus === "error";

  if (!agentInstanceId) return null;

  return (
    <div className={styles.container}>
      {isMobileLayout && projectId ? (
        <section className={styles.projectAgentBar}>
          {projectAgents.length > 1 ? (
            <label className={styles.projectAgentSelectWrap}>
              <Bot size={16} aria-hidden="true" />
              <select
                aria-label="Project agent"
                className={styles.projectAgentSelect}
                value={agentInstanceId}
                onChange={(event) => handleProjectAgentChange(event.target.value)}
              >
                {projectAgents.map((agent) => (
                  <option key={agent.agent_instance_id} value={agent.agent_instance_id}>
                    {agent.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} aria-hidden="true" className={styles.projectAgentChevron} />
            </label>
          ) : (
            <div className={styles.projectAgentSummary}>
              <Bot size={16} aria-hidden="true" />
              <div className={styles.projectAgentSummaryCopy}>
                <span className={styles.projectAgentName}>
                  {selectedProjectAgent?.name ?? agentName ?? (isLoadingProjectAgents ? "Loading project agent..." : "Project agent")}
                </span>
                <span className={styles.projectAgentSummaryHint}>
                  {selectedProjectAgent?.role ?? "Chat in this project's agent context."}
                </span>
              </div>
            </div>
          )}
        </section>
      ) : null}
      <ChatPanel
        key={agentInstanceId}
        streamKey={streamKey}
        onSend={wrappedSend}
        onStop={stopStreaming}
        agentName={selectedProjectAgent?.name ?? agentName}
        isLoading={deferredLoading}
        historyResolved={historyResolved}
        contextUsagePercent={projectId && agentInstanceId ? contextUsagePercent : undefined}
        scrollResetKey={agentInstanceId}
      />
    </div>
  );
}
