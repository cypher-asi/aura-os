import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../api/client";
import { useChatStream } from "../../hooks/use-chat-stream";
import { useIsStreaming } from "../../hooks/stream/hooks";
import { setLastAgent } from "../../utils/storage";
import { ChatPanel } from "../ChatPanel";
import { useChatHistoryStore, useChatHistory, projectChatHistoryKey } from "../../stores/chat-history-store";

export function ChatView() {
  const { projectId, agentInstanceId } = useParams<{
    projectId: string;
    agentInstanceId: string;
  }>();

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

  // Fetch agent instance metadata (name)
  useEffect(() => {
    const loadId = ++metadataLoadIdRef.current;
    const controller = new AbortController();

    if (projectId && agentInstanceId) {
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

  // Fetch context usage
  const fetchActiveSessionContext = useCallback(async () => {
    if (!projectId || !agentInstanceId) return null;
    try {
      const sessions = await api.listSessions(projectId, agentInstanceId);
      const active = sessions.find((s) => s.status === "active");
      if (active != null && typeof active.context_usage_estimate === "number") {
        return Math.round(active.context_usage_estimate * 100);
      }
    } catch { /* ignore */ }
    return null;
  }, [projectId, agentInstanceId]);

  useEffect(() => {
    let cancelled = false;
    void fetchActiveSessionContext().then((p) => { if (!cancelled) setContextUsagePercent(p); });
    return () => { cancelled = true; };
  }, [fetchActiveSessionContext]);

  const prevIsStreamingRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    if (prevIsStreamingRef.current && !isStreaming) {
      void fetchActiveSessionContext().then((p) => { if (!cancelled) setContextUsagePercent(p); });
    }
    prevIsStreamingRef.current = isStreaming;
    return () => { cancelled = true; };
  }, [isStreaming, fetchActiveSessionContext]);

  // Load chat history via shared store
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

  // Sync history messages to stream store
  useEffect(() => {
    if (historyMessages.length === 0) return;
    resetMessagesRef.current(historyMessages, { allowWhileStreaming: true });
  }, [historyMessages]);

  const wrappedSend = useCallback(
    (...args: Parameters<typeof sendMessage>) => {
      if (historyKey) {
        useChatHistoryStore.getState().invalidateHistory(historyKey);
      }
      return sendMessage(...args);
    },
    [sendMessage, historyKey],
  );

  if (!agentInstanceId) return null;

  return (
    <ChatPanel
      key={agentInstanceId}
      streamKey={streamKey}
      onSend={wrappedSend}
      onStop={stopStreaming}
      agentName={agentName}
      isLoading={historyStatus === "loading" || historyStatus === "idle"}
      contextUsagePercent={projectId && agentInstanceId ? contextUsagePercent : undefined}
      scrollResetKey={agentInstanceId}
    />
  );
}
