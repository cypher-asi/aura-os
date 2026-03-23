import { useEffect, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Bot, ChevronDown } from "lucide-react";
import { api } from "../../api/client";
import { useChatStream } from "../../hooks/use-chat-stream";
import { useIsStreaming } from "../../hooks/stream/hooks";
import { useDelayedLoading } from "../../hooks/use-delayed-loading";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { projectAgentChatRoute } from "../../utils/mobileNavigation";
import { ChatPanel } from "../ChatPanel";
import { useChatHistoryStore, useChatHistory, projectChatHistoryKey } from "../../stores/chat-history-store";
import { useProjectAgentState } from "./useProjectAgentState";
import styles from "./ChatView.module.css";

export function ChatView() {
  const navigate = useNavigate();
  const { projectId, agentInstanceId } = useParams<{
    projectId: string;
    agentInstanceId: string;
  }>();
  const { isMobileLayout } = useAuraCapabilities();
  const {
    projectAgents,
    isLoadingProjectAgents,
    selectedProjectAgent,
    agentDisplayName,
    contextUsagePercent,
  } = useProjectAgentState({ projectId, agentInstanceId });

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

  const resetMessagesRef = useRef(resetMessages);
  useEffect(() => { resetMessagesRef.current = resetMessages; }, [resetMessages]);

  const prevIsStreamingRef = useRef(false);
  useEffect(() => {
    if (prevIsStreamingRef.current && !isStreaming) {
      if (historyKey) {
        useChatHistoryStore.getState().invalidateHistory(historyKey);
      }
    }
    prevIsStreamingRef.current = isStreaming;
  }, [isStreaming, historyKey]);

  // Load chat history via shared store
  useEffect(() => {
    if (!projectId || !agentInstanceId) {
      queueMicrotask(() => {
        resetMessagesRef.current([], { allowWhileStreaming: true });
      });
      return;
    }
    const key = projectChatHistoryKey(projectId, agentInstanceId);
    useChatHistoryStore.getState().fetchHistory(
      key,
      () => api.getMessages(projectId, agentInstanceId),
    );
  }, [projectId, agentInstanceId]);

  // Sync history messages to stream store
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

  const rawLoading = historyStatus === "loading" || historyStatus === "idle";
  const deferredLoading = useDelayedLoading(rawLoading);
  const historyResolved = historyStatus === "ready" || historyStatus === "error";
  const handleProjectAgentChange = useCallback((nextAgentInstanceId: string) => {
    if (!projectId || !nextAgentInstanceId || nextAgentInstanceId === agentInstanceId) return;
    navigate(projectAgentChatRoute(projectId, nextAgentInstanceId));
  }, [agentInstanceId, navigate, projectId]);

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
                  {agentDisplayName ?? (isLoadingProjectAgents ? "Loading project agent..." : "Project agent")}
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
        agentName={agentDisplayName}
        isLoading={deferredLoading}
        historyResolved={historyResolved}
        contextUsagePercent={projectId && agentInstanceId ? contextUsagePercent : undefined}
        scrollResetKey={agentInstanceId}
      />
    </div>
  );
}
