import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { api, STANDALONE_AGENT_HISTORY_LIMIT } from "../api/client";
import { useAgentChatStream } from "./use-agent-chat-stream";
import { useChatHistorySync } from "./use-chat-history-sync";
import { useDelayedLoading } from "../shared/hooks/use-delayed-loading";
import { useStandaloneAgentMeta } from "./use-agent-chat-meta";
import { agentHistoryKey } from "../stores/chat-history-store";
import { useAgentStore } from "../apps/agents/stores";
import { useProjectsListStore } from "../stores/projects-list-store";
import { useContextUsage, useContextUsageStore } from "../stores/context-usage-store";
import { useHydrateContextUtilization } from "./use-hydrate-context-utilization";
import type { ChatPanelProps } from "../apps/chat/components/ChatPanel";
import type { AgentInstance, Project } from "../shared/types";

const AGENT_PROJECT_KEY_PREFIX = "aura-agent-project:";
const EMPTY_PROJECTS: Project[] = [];

function selectProjectsForAgent(agentId: string | undefined) {
  return (state: { projects: Project[]; agentsByProject: Record<string, AgentInstance[]> }) => {
    if (!agentId) return EMPTY_PROJECTS;
    return state.projects.filter((project) => {
      const instances = state.agentsByProject[project.project_id];
      return instances?.some((instance) => instance.agent_id === agentId);
    });
  };
}

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
 * Single source of truth for standalone-agent chat wiring.
 *
 * Both the route view (`/agents/:agentId` -> `StandaloneAgentChatPanel`) and the
 * floating desktop window (`AgentWindow`) consume this hook so the two surfaces
 * stay behaviourally identical. Route-only concerns (`scrollToBottomOnReset`,
 * `initialHandoff`, `LAST_AGENT_ID_KEY` persistence) are layered on top by the
 * caller after the fact.
 *
 * Returns `ChatPanelProps`. `agentId` may be undefined to support the
 * floating-window mount race where the window is rendered before the agent
 * list has resolved.
 */
export function useStandaloneAgentChat(agentId: string | undefined): ChatPanelProps {
  const agentProjects = useProjectsListStore(useShallow(selectProjectsForAgent(agentId)));

  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(() => {
    if (!agentId) return undefined;
    return loadPersistedProject(agentId);
  });

  useEffect(() => {
    if (!agentId) return;
    setSelectedProjectId(loadPersistedProject(agentId));
  }, [agentId]);

  const effectiveProjectId = useMemo(() => {
    if (selectedProjectId && agentProjects.some((project) => project.project_id === selectedProjectId)) {
      return selectedProjectId;
    }
    return agentProjects[0]?.project_id;
  }, [selectedProjectId, agentProjects]);

  const handleProjectChange = useCallback(
    (projectId: string) => {
      setSelectedProjectId(projectId);
      if (agentId) persistAgentProject(agentId, projectId);
    },
    [agentId],
  );

  const { streamKey, sendMessage, stopStreaming, resetEvents, markNextSendAsNewSession } =
    useAgentChatStream({ agentId });

  const { agentName, machineType, templateAgentId, adapterType, defaultModel } =
    useStandaloneAgentMeta(agentId);

  const contextUsage = useContextUsage(streamKey);

  const historyKey = useMemo(() => {
    if (!agentId) return undefined;
    return agentHistoryKey(agentId);
  }, [agentId]);

  const fetchFn = useMemo(() => {
    if (!agentId) return undefined;
    return () =>
      api.agents.listEvents(agentId, {
        limit: STANDALONE_AGENT_HISTORY_LIMIT,
      });
  }, [agentId]);

  const setSelectedAgent = useAgentStore((s) => s.setSelectedAgent);
  const onSwitch = useCallback(() => {
    if (!agentId) return;
    setSelectedAgent(agentId);
  }, [agentId, setSelectedAgent]);

  const onClear = useCallback(() => {
    resetEvents([], { allowWhileStreaming: true });
  }, [resetEvents]);

  const handleNewSession = useCallback(() => {
    if (!agentId) return;
    void import("../lib/analytics").then(({ track }) => track("chat_session_reset"));
    api.agents.resetSession(agentId).catch(() => {});
    markNextSendAsNewSession();
    const store = useContextUsageStore.getState();
    store.clearContextUtilization(streamKey);
    // Mark a reset sentinel so the hydration hook doesn't resurrect the old
    // session's value if the view remounts before the next send (e.g. nav
    // away and back) or if the reset API call is slow to propagate.
    store.markResetPending(streamKey);
  }, [agentId, markNextSendAsNewSession, streamKey]);

  const contextUsageFetcher = useMemo(() => {
    if (!agentId) return undefined;
    return (signal: AbortSignal) => api.agents.getContextUsage(agentId, { signal });
  }, [agentId]);

  useHydrateContextUtilization(streamKey, contextUsageFetcher, agentId);

  const { historyMessages, historyResolved, isLoading, historyError, wrapSend } =
    useChatHistorySync({
      historyKey,
      streamKey,
      fetchFn,
      resetEvents,
      invalidateBeforeFetch: false,
      onSwitch,
      onClear,
      hydrateToStream: false,
      // Standalone agent chats are keyed by the org-level `agent_id`
      // (see `agentHistoryKey`), so we subscribe to that axis — not
      // `project_agent_id`. Without this, a `send_to_agent` delivery
      // persists into the target agent's session but the chat panel
      // stays stale until the user hits F5.
      watchAgentId: agentId,
    });

  const wrappedSend = useMemo(
    () => wrapSend(sendMessage),
    [wrapSend, sendMessage],
  );

  const deferredLoading = useDelayedLoading(isLoading);

  return {
    streamKey,
    onSend: wrappedSend,
    onStop: stopStreaming,
    agentName,
    machineType,
    adapterType,
    defaultModel,
    templateAgentId,
    agentId,
    isLoading: deferredLoading,
    historyResolved,
    errorMessage: historyError ?? null,
    scrollResetKey: agentId,
    historyMessages,
    projects: agentProjects,
    selectedProjectId: effectiveProjectId,
    onProjectChange: handleProjectChange,
    contextUsage,
    onNewSession: handleNewSession,
  };
}
