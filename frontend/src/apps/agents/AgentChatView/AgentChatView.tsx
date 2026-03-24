import { useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../../api/client";
import { useAgentChatStream } from "../../../hooks/use-agent-chat-stream";
import { useIsStreaming } from "../../../hooks/stream/hooks";
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
  const isStreaming = useIsStreaming(streamKey);

  const resetMessagesRef = useRef(resetMessages);
  useEffect(() => { resetMessagesRef.current = resetMessages; }, [resetMessages]);

  // Invalidate stale cache when streaming stops so the next navigation gets
  // fresh data even if the user leaves before the finally-block runs.
  const prevIsStreamingRef = useRef(false);
  useEffect(() => {
    if (prevIsStreamingRef.current && !isStreaming) {
      if (historyKey) {
        useChatHistoryStore.getState().invalidateHistory(historyKey);
      }
    }
    prevIsStreamingRef.current = isStreaming;
  }, [isStreaming, historyKey]);

  // Fetch history from the server on every agent switch.
  // Do NOT read from the manual cache — let the second effect apply data once
  // the fetch completes, avoiding stale-data flashes.
  useEffect(() => {
    if (!agentId) {
      resetMessagesRef.current([], { allowWhileStreaming: true });
      return;
    }
    const key = agentHistoryKey(agentId);
    useChatHistoryStore.getState().invalidateHistory(key);
    useChatHistoryStore.getState().fetchHistory(
      key,
      () => api.agents.listMessages(agentId),
    );
    setSelectedAgent(agentId);
    localStorage.setItem(LAST_AGENT_ID_KEY, agentId);
  }, [agentId, setSelectedAgent]);

  // Sync fetched history into the stream store for rendering.
  useEffect(() => {
    if (historyStatus !== "ready") return;
    resetMessagesRef.current(historyMessages, { allowWhileStreaming: true });
  }, [historyMessages, historyStatus]);

  // Invalidate cache before sending so navigating away mid-stream and back
  // forces a fresh fetch (mirrors ChatView.wrappedSend pattern).
  const wrappedSend = useCallback(
    (...args: Parameters<typeof sendMessage>) => {
      if (historyKey) {
        useChatHistoryStore.getState().invalidateHistory(historyKey);
      }
      return sendMessage(...args);
    },
    [sendMessage, historyKey],
  );

  if (!agentId) return null;

  return (
    <ChatPanel
      key={agentId}
      streamKey={streamKey}
      onSend={wrappedSend}
      onStop={stopStreaming}
      agentName={selectedAgent?.name}
      isLoading={showHistoryLoading}
      errorMessage={historyStatus === "error" ? (historyError ?? "Failed to load conversation") : null}
      emptyMessage="Send a message"
      scrollResetKey={agentId}
    />
  );
}
