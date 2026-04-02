import { useCallback, useMemo, useState } from "react";
import { api } from "../api/client";
import { useChatStreamAdapter } from "./use-chat-stream-adapter";
import { useChatHistorySync } from "./use-chat-history-sync";
import { useDelayedLoading } from "./use-delayed-loading";
import { useAgentChatMeta } from "./use-agent-chat-meta";
import { agentHistoryKey } from "../stores/chat-history-store";
import { useAgentStore } from "../apps/agents/stores";
import { useProjectsListStore } from "../stores/projects-list-store";
import type { ChatPanelProps } from "../components/ChatPanel";

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

/**
 * Standalone agent chat wiring extracted from AgentChatView so it can be
 * reused by both the route-based view and desktop floating windows.
 *
 * Returns all the props that ChatPanel needs.
 */
export function useAgentChatWindow(agentId: string | undefined): ChatPanelProps & { ready: boolean } {
  const allProjects = useProjectsListStore((s) => s.projects);
  const agentsByProject = useProjectsListStore((s) => s.agentsByProject);

  const agentProjects = useMemo(() => {
    if (!agentId) return [];
    return allProjects.filter((p) => {
      const instances = agentsByProject[p.project_id];
      return instances?.some((inst) => inst.agent_id === agentId);
    });
  }, [agentId, allProjects, agentsByProject]);

  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(() => {
    if (!agentId) return undefined;
    return loadPersistedProject(agentId);
  });

  const effectiveProjectId = useMemo(() => {
    if (selectedProjectId && agentProjects.some((p) => p.project_id === selectedProjectId)) {
      return selectedProjectId;
    }
    return agentProjects[0]?.project_id;
  }, [selectedProjectId, agentProjects]);

  const handleProjectChange = useCallback(
    (pid: string) => {
      setSelectedProjectId(pid);
      if (agentId) persistAgentProject(agentId, pid);
    },
    [agentId],
  );

  const { streamKey, sendMessage, stopStreaming, resetEvents } =
    useChatStreamAdapter("agent", { agentId });

  const { agentName, machineType, templateAgentId } = useAgentChatMeta("agent", { agentId });

  const historyKey = useMemo(() => {
    if (!agentId) return undefined;
    return agentHistoryKey(agentId);
  }, [agentId]);

  const fetchFn = useMemo(() => {
    if (!agentId) return undefined;
    return () => api.agents.listEvents(agentId);
  }, [agentId]);

  const setSelectedAgent = useAgentStore((s) => s.setSelectedAgent);
  const onAgentSwitch = useCallback(() => {
    if (!agentId) return;
    setSelectedAgent(agentId);
  }, [agentId, setSelectedAgent]);

  const onClear = useCallback(() => {
    resetEvents([], { allowWhileStreaming: true });
  }, [resetEvents]);

  const { historyResolved, isLoading, historyError, wrapSend } = useChatHistorySync({
    historyKey,
    streamKey,
    fetchFn,
    resetEvents,
    invalidateBeforeFetch: true,
    onSwitch: onAgentSwitch,
    onClear,
  });

  const wrappedSend = useMemo(
    () => wrapSend(sendMessage),
    [wrapSend, sendMessage],
  );

  const deferredLoading = useDelayedLoading(isLoading);

  return {
    ready: !!agentId,
    streamKey,
    onSend: wrappedSend,
    onStop: stopStreaming,
    agentName,
    machineType,
    templateAgentId,
    agentId,
    isLoading: deferredLoading,
    historyResolved,
    errorMessage: historyError ?? null,
    emptyMessage: "Send a message",
    scrollResetKey: agentId,
    projects: agentProjects,
    selectedProjectId: effectiveProjectId,
    onProjectChange: handleProjectChange,
  };
}
