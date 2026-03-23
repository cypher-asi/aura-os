import { useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../../api/client";
import { useAgentChatStream } from "../../../hooks/use-agent-chat-stream";
import { ChatPanel } from "../../../components/ChatPanel";
import { useChatHistoryStore, useChatHistory, agentHistoryKey } from "../../../stores/chat-history-store";
import { useSelectedAgent, LAST_AGENT_ID_KEY } from "../stores";

export function AgentChatView() {
  const { agentId } = useParams<{ agentId: string }>();
  const historyKey = agentId ? agentHistoryKey(agentId) : undefined;
  const { selectedAgent, setSelectedAgent } = useSelectedAgent();
  const { messages: historyMessages, status: historyStatus, error: historyError } = useChatHistory(historyKey);
  const showHistoryLoading = historyStatus === "loading" || historyStatus === "idle";

  const {
    streamKey,
    sendMessage,
    stopStreaming,
    resetMessages,
  } = useAgentChatStream({ agentId });

  const resetMessagesRef = useRef(resetMessages);
  useEffect(() => { resetMessagesRef.current = resetMessages; }, [resetMessages]);

  useEffect(() => {
    if (!agentId) return;
    const key = agentHistoryKey(agentId);
    resetMessagesRef.current([], { allowWhileStreaming: true });
    const cached = useChatHistoryStore.getState().entries[key];
    if (cached?.status === "ready") {
      resetMessagesRef.current(cached.messages, { allowWhileStreaming: true });
    }
    useChatHistoryStore.getState().fetchHistory(
      key,
      () => api.agents.listMessages(agentId),
    );
    setSelectedAgent(agentId);
    localStorage.setItem(LAST_AGENT_ID_KEY, agentId);
  }, [agentId, setSelectedAgent]);

  useEffect(() => {
    if (historyStatus !== "ready") return;
    resetMessagesRef.current(historyMessages, { allowWhileStreaming: true });
  }, [historyMessages, historyStatus]);

  if (!agentId) return null;

  return (
    <ChatPanel
      streamKey={streamKey}
      onSend={sendMessage}
      onStop={stopStreaming}
      agentName={selectedAgent?.name}
      isLoading={showHistoryLoading}
      errorMessage={historyStatus === "error" ? (historyError ?? "Failed to load conversation") : null}
      emptyMessage="Send a message"
      scrollResetKey={agentId}
    />
  );
}
