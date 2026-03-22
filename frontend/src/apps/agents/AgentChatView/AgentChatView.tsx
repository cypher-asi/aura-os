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
    useChatHistoryStore.getState().fetchHistory(
      agentHistoryKey(agentId),
      () => api.agents.listMessages(agentId),
    );
    setSelectedAgent(agentId);
    localStorage.setItem(LAST_AGENT_ID_KEY, agentId);
  }, [agentId, setSelectedAgent]);

  useEffect(() => {
    if (historyMessages.length === 0) return;
    resetMessagesRef.current(historyMessages, { allowWhileStreaming: true });
  }, [historyMessages]);

  if (!agentId) return null;

  return (
    <ChatPanel
      key={agentId}
      streamKey={streamKey}
      onSend={sendMessage}
      onStop={stopStreaming}
      agentName={selectedAgent?.name}
      isLoading={historyStatus === "loading" || historyStatus === "idle"}
      errorMessage={historyStatus === "error" ? (historyError ?? "Failed to load conversation") : null}
      emptyMessage="Send a message"
      scrollResetKey={agentId}
    />
  );
}
