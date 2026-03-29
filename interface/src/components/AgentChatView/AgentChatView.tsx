import { useCallback, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../api/client";
import { useChatStreamAdapter } from "../../hooks/use-chat-stream-adapter";
import { useChatHistorySync } from "../../hooks/use-chat-history-sync";
import { useDelayedLoading } from "../../hooks/use-delayed-loading";
import { useAgentChatMeta } from "../../hooks/use-agent-chat-meta";
import { setLastAgent, setLastProject } from "../../utils/storage";
import { ChatPanel } from "../ChatPanel";
import { projectChatHistoryKey, agentHistoryKey } from "../../stores/chat-history-store";
import { useSelectedAgent, LAST_AGENT_ID_KEY } from "../../apps/agents/stores";
import { useProjectsListStore } from "../../stores/projects-list-store";

const AGENT_PROJECT_KEY_PREFIX = "aura-agent-project:";

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

type ChatMode = "project" | "agent";

export function AgentChatView() {
  const { projectId, agentInstanceId, agentId } = useParams<{
    projectId: string;
    agentInstanceId: string;
    agentId: string;
  }>();

  const mode: ChatMode = projectId && agentInstanceId ? "project" : "agent";
  const entityId = mode === "project" ? agentInstanceId : agentId;

  // ── Derive project list for the dropdown ─────────────────────────────
  const allProjects = useProjectsListStore((s) => s.projects);
  const agentsByProject = useProjectsListStore((s) => s.agentsByProject);

  const agentProjects = useMemo(() => {
    if (mode !== "agent" || !agentId) return [];
    return allProjects.filter((p) => {
      const instances = agentsByProject[p.project_id];
      return instances?.some((inst) => inst.agent_id === agentId);
    });
  }, [mode, agentId, allProjects, agentsByProject]);

  const currentProject = useMemo(() => {
    if (mode !== "project" || !projectId) return [];
    const found = allProjects.find((p) => p.project_id === projectId);
    return found ? [found] : [];
  }, [mode, projectId, allProjects]);

  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(() => {
    if (mode !== "agent" || !agentId) return undefined;
    return loadPersistedProject(agentId);
  });

  const effectiveProjectId = useMemo(() => {
    if (mode !== "agent") return undefined;
    if (selectedProjectId && agentProjects.some((p) => p.project_id === selectedProjectId)) {
      return selectedProjectId;
    }
    return agentProjects[0]?.project_id;
  }, [mode, selectedProjectId, agentProjects]);

  const handleProjectChange = useCallback(
    (pid: string) => {
      setSelectedProjectId(pid);
      if (agentId) persistAgentProject(agentId, pid);
    },
    [agentId],
  );

  // ── Stream hook (calls both, only active one receives real IDs) ─────
  const { streamKey, sendMessage, stopStreaming, resetEvents } =
    useChatStreamAdapter(mode, { projectId, agentInstanceId, agentId });

  // ── Unified agent metadata (name, machineType, templateAgentId) ────
  const { agentName, machineType, templateAgentId } = useAgentChatMeta(mode, {
    projectId,
    agentInstanceId,
    agentId,
  });

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
  const { setSelectedAgent } = useSelectedAgent();
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

  // ── Render ──────────────────────────────────────────────────────────
  if (!entityId) return null;

  return (
    <ChatPanel
      key={entityId}
      streamKey={streamKey}
      onSend={wrappedSend}
      onStop={stopStreaming}
      agentName={agentName}
      machineType={machineType}
      templateAgentId={templateAgentId}
      agentId={entityId}
      isLoading={deferredLoading}
      historyResolved={historyResolved}
      errorMessage={historyError ? historyError : null}
      emptyMessage={mode === "agent" ? "Send a message" : undefined}
      scrollResetKey={entityId}
      projects={mode === "agent" ? agentProjects : currentProject}
      selectedProjectId={mode === "agent" ? effectiveProjectId : projectId}
      onProjectChange={mode === "agent" ? handleProjectChange : undefined}
    />
  );
}
