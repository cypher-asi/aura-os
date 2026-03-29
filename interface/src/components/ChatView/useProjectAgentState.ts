import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentInstance } from "../../types";
import { api } from "../../api/client";
import { setLastAgent, setLastProject } from "../../utils/storage";
import { useProjectsListStore } from "../../stores/projects-list-store";

const EMPTY_PROJECT_AGENTS: readonly AgentInstance[] = [];

interface UseProjectAgentStateArgs {
  projectId?: string;
  agentInstanceId?: string;
}

interface UseProjectAgentStateResult {
  projectAgents: readonly AgentInstance[];
  isLoadingProjectAgents: boolean;
  selectedProjectAgent: AgentInstance | null;
  agentDisplayName: string | undefined;
  contextUsagePercent: number | null;
}

export function useProjectAgentState({
  projectId,
  agentInstanceId,
}: UseProjectAgentStateArgs): UseProjectAgentStateResult {
  const projectAgents = useProjectsListStore((state) => (
    projectId ? state.agentsByProject[projectId] ?? EMPTY_PROJECT_AGENTS : EMPTY_PROJECT_AGENTS
  ));
  const isLoadingProjectAgents = useProjectsListStore((state) => (
    projectId ? Boolean(state.loadingAgentsByProject[projectId]) : false
  ));
  const refreshProjectAgents = useProjectsListStore((state) => state.refreshProjectAgents);

  const [fallbackAgentMetadata, setFallbackAgentMetadata] = useState<{
    agentInstanceId?: string;
    name?: string;
  }>({});
  const [contextUsagePercent, setContextUsagePercent] = useState<number | null>(null);
  const metadataLoadIdRef = useRef(0);

  const selectedProjectAgent = projectAgents.find((agent) => agent.agent_instance_id === agentInstanceId) ?? null;

  useEffect(() => {
    if (!projectId) return;
    if (projectAgents.length > 0 || isLoadingProjectAgents) return;
    void refreshProjectAgents(projectId).catch(() => {});
  }, [isLoadingProjectAgents, projectAgents.length, projectId, refreshProjectAgents]);

  useEffect(() => {
    const loadId = ++metadataLoadIdRef.current;
    const controller = new AbortController();

    if (projectId && agentInstanceId) {
      setLastProject(projectId);
      setLastAgent(projectId, agentInstanceId);
    }

    if (!selectedProjectAgent && projectId && agentInstanceId) {
      api
        .getAgentInstance(projectId, agentInstanceId, { signal: controller.signal })
        .then((instance) => {
          if (loadId === metadataLoadIdRef.current) {
            setFallbackAgentMetadata({
              agentInstanceId: instance.agent_instance_id,
              name: instance.name,
            });
          }
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
        });
    }

    return () => {
      controller.abort();
    };
  }, [agentInstanceId, projectId, selectedProjectAgent]);

  const fetchActiveSessionContext = useCallback(async (): Promise<number | null> => {
    if (!projectId || !agentInstanceId) return null;
    try {
      const sessions = await api.listSessions(projectId, agentInstanceId);
      const active = sessions.find((session) => session.status === "active");
      if (active != null && typeof active.context_usage_estimate === "number") {
        return Math.round(active.context_usage_estimate * 100);
      }
    } catch {
      // ignore
    }
    return null;
  }, [agentInstanceId, projectId]);

  useEffect(() => {
    let cancelled = false;
    void fetchActiveSessionContext().then((percent) => {
      if (!cancelled) setContextUsagePercent(percent);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchActiveSessionContext]);

  return {
    projectAgents,
    isLoadingProjectAgents,
    selectedProjectAgent,
    agentDisplayName:
      selectedProjectAgent?.name
      ?? (fallbackAgentMetadata.agentInstanceId === agentInstanceId
        ? fallbackAgentMetadata.name
        : undefined),
    contextUsagePercent,
  };
}
