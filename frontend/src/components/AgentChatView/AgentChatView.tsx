import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../api/client";
import { useChatStreamAdapter } from "../../hooks/use-chat-stream-adapter";
import { useChatHistorySync } from "../../hooks/use-chat-history-sync";
import { useIsStreaming } from "../../hooks/stream/hooks";
import { useDelayedLoading } from "../../hooks/use-delayed-loading";
import { setLastAgent, setLastProject } from "../../utils/storage";
import { ChatPanel } from "../ChatPanel";
import { projectChatHistoryKey, agentHistoryKey } from "../../stores/chat-history-store";
import { useSelectedAgent, LAST_AGENT_ID_KEY } from "../../apps/agents/stores";

type ChatMode = "project" | "agent";

export function AgentChatView() {
  const { projectId, agentInstanceId, agentId } = useParams<{
    projectId: string;
    agentInstanceId: string;
    agentId: string;
  }>();

  const mode: ChatMode = projectId && agentInstanceId ? "project" : "agent";
  const entityId = mode === "project" ? agentInstanceId : agentId;

  // ── Stream hook (calls both, only active one receives real IDs) ─────
  const { streamKey, sendMessage, stopStreaming, resetEvents } =
    useChatStreamAdapter(mode, { projectId, agentInstanceId, agentId });

  const isStreaming = useIsStreaming(streamKey);

  // ── History key ─────────────────────────────────────────────────────
  const historyKey = useMemo(() => {
    if (mode === "project" && projectId && agentInstanceId) {
      return projectChatHistoryKey(projectId, agentInstanceId);
    }
    if (mode === "agent" && agentId) {
      return agentHistoryKey(agentId);
    }
    return undefined;
  }, [mode, projectId, agentInstanceId, agentId]);

  // ── History fetch function ──────────────────────────────────────────
  const fetchFn = useMemo(() => {
    if (mode === "project" && projectId && agentInstanceId) {
      return () => api.getEvents(projectId, agentInstanceId);
    }
    if (mode === "agent" && agentId) {
      return () => api.agents.listEvents(agentId);
    }
    return undefined;
  }, [mode, projectId, agentInstanceId, agentId]);

  // ── Agent-mode: selection persistence ───────────────────────────────
  const { selectedAgent, setSelectedAgent } = useSelectedAgent();
  const onAgentSwitch = useCallback(() => {
    if (mode !== "agent" || !agentId) return;
    setSelectedAgent(agentId);
    localStorage.setItem(LAST_AGENT_ID_KEY, agentId);
  }, [mode, agentId, setSelectedAgent]);

  // ── Project-mode: storage + context usage ───────────────────────────
  const [contextUsagePercent, setContextUsagePercent] = useState<number | null>(null);

  const onProjectSwitch = useCallback(() => {
    if (mode !== "project" || !projectId || !agentInstanceId) return;
    setLastProject(projectId);
    setLastAgent(projectId, agentInstanceId);
  }, [mode, projectId, agentInstanceId]);

  const onClear = useCallback(() => {
    resetEvents([], { allowWhileStreaming: true });
    setContextUsagePercent(null);
  }, [resetEvents]);

  // ── Shared history sync ─────────────────────────────────────────────
  const { historyResolved, isLoading, historyError, wrapSend } = useChatHistorySync({
    historyKey,
    streamKey,
    fetchFn,
    resetEvents,
    invalidateBeforeFetch: mode === "agent",
    onSwitch: mode === "project" ? onProjectSwitch : onAgentSwitch,
    onClear: mode === "project" ? onClear : () => resetEvents([], { allowWhileStreaming: true }),
  });

  const wrappedSend = useMemo(
    () => wrapSend(sendMessage),
    [wrapSend, sendMessage],
  );

  const deferredLoading = useDelayedLoading(isLoading);

  // ── Project-mode: agent name from API ───────────────────────────────
  const [agentName, setAgentName] = useState<string | undefined>();
  const metadataLoadIdRef = useRef(0);

  useEffect(() => {
    if (mode !== "project" || !projectId || !agentInstanceId) {
      setAgentName(undefined);
      return;
    }
    const loadId = ++metadataLoadIdRef.current;
    const controller = new AbortController();
    api
      .getAgentInstance(projectId, agentInstanceId, { signal: controller.signal })
      .then((inst) => {
        if (loadId === metadataLoadIdRef.current) setAgentName(inst.name);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
      });
    return () => { controller.abort(); };
  }, [mode, projectId, agentInstanceId]);

  // ── Project-mode: context usage meter ───────────────────────────────
  const fetchActiveSessionContext = useCallback(async () => {
    if (mode !== "project" || !projectId || !agentInstanceId) return null;
    try {
      const sessions = await api.listSessions(projectId, agentInstanceId);
      const active = sessions.find((s) => s.status === "active");
      if (active != null && typeof active.context_usage_estimate === "number") {
        return Math.round(active.context_usage_estimate * 100);
      }
    } catch { /* ignore */ }
    return null;
  }, [mode, projectId, agentInstanceId]);

  useEffect(() => {
    let cancelled = false;
    void fetchActiveSessionContext().then((p) => { if (!cancelled) setContextUsagePercent(p); });
    return () => { cancelled = true; };
  }, [fetchActiveSessionContext]);

  const prevIsStreamingRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    if (prevIsStreamingRef.current && !isStreaming && mode === "project") {
      void fetchActiveSessionContext().then((p) => { if (!cancelled) setContextUsagePercent(p); });
    }
    prevIsStreamingRef.current = isStreaming;
    return () => { cancelled = true; };
  }, [isStreaming, fetchActiveSessionContext, mode]);

  // ── Render ──────────────────────────────────────────────────────────
  if (!entityId) return null;

  const displayName = mode === "project" ? agentName : selectedAgent?.name;

  return (
    <ChatPanel
      key={entityId}
      streamKey={streamKey}
      onSend={wrappedSend}
      onStop={stopStreaming}
      agentName={displayName}
      isLoading={deferredLoading}
      historyResolved={historyResolved}
      errorMessage={historyError ? historyError : null}
      emptyMessage={mode === "agent" ? "Send a message" : undefined}
      contextUsagePercent={mode === "project" ? contextUsagePercent : undefined}
      scrollResetKey={entityId}
    />
  );
}
