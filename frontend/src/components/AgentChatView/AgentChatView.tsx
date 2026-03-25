import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../api/client";
import { useChatStreamAdapter } from "../../hooks/use-chat-stream-adapter";
import { useChatHistorySync } from "../../hooks/use-chat-history-sync";
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

  // ── Project-mode: storage ──────────────────────────────────────────
  const onProjectSwitch = useCallback(() => {
    if (mode !== "project" || !projectId || !agentInstanceId) return;
    setLastProject(projectId);
    setLastAgent(projectId, agentInstanceId);
  }, [mode, projectId, agentInstanceId]);

  const onClear = useCallback(() => {
    resetEvents([], { allowWhileStreaming: true });
  }, [resetEvents]);

  // ── Shared history sync ─────────────────────────────────────────────
  const { historyResolved, isLoading, historyError, wrapSend } = useChatHistorySync({
    historyKey,
    streamKey,
    fetchFn,
    resetEvents,
    invalidateBeforeFetch: mode === "agent",
    onSwitch: mode === "project" ? onProjectSwitch : onAgentSwitch,
    onClear,
  });

  const wrappedSend = useMemo(
    () => wrapSend(sendMessage),
    [wrapSend, sendMessage],
  );

  const deferredLoading = useDelayedLoading(isLoading);

  // ── Project-mode: agent metadata from API ──────────────────────────
  const [agentName, setAgentName] = useState<string | undefined>();
  const [machineType, setMachineType] = useState<"local" | "remote" | undefined>();
  const metadataLoadIdRef = useRef(0);

  useEffect(() => {
    if (mode !== "project" || !projectId || !agentInstanceId) return;
    const loadId = ++metadataLoadIdRef.current;
    const controller = new AbortController();
    api
      .getAgentInstance(projectId, agentInstanceId, { signal: controller.signal })
      .then((inst) => {
        if (loadId !== metadataLoadIdRef.current) return;
        setAgentName(inst.name);
        setMachineType(inst.machine_type === "remote" ? "remote" : "local");
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
      });
    return () => { controller.abort(); };
  }, [mode, projectId, agentInstanceId]);

  // ── Render ──────────────────────────────────────────────────────────
  if (!entityId) return null;

  const displayName = mode === "project" ? agentName : selectedAgent?.name;
  const resolvedMachineType: "local" | "remote" | undefined =
    mode === "project"
      ? machineType
      : selectedAgent?.machine_type === "remote" ? "remote" : "local";

  return (
    <ChatPanel
      key={entityId}
      streamKey={streamKey}
      onSend={wrappedSend}
      onStop={stopStreaming}
      agentName={displayName}
      machineType={resolvedMachineType}
      agentId={entityId}
      isLoading={deferredLoading}
      historyResolved={historyResolved}
      errorMessage={historyError ? historyError : null}
      emptyMessage={mode === "agent" ? "Send a message" : undefined}
      scrollResetKey={entityId}
    />
  );
}
