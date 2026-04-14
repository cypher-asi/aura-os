import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { useAgentStore, useSelectedAgent } from "../apps/agents/stores";
import { projectAgentInstanceQueryOptions } from "../queries/project-queries";
import type { Agent } from "../types";

type ChatMode = "project" | "agent";

export interface AgentChatMeta {
  agentName: string | undefined;
  machineType: "local" | "remote" | undefined;
  templateAgentId: string | undefined;
  adapterType: string | undefined;
  defaultModel: string | null | undefined;
}

const EMPTY_AGENT_CHAT_META: AgentChatMeta = {
  agentName: undefined,
  machineType: undefined,
  templateAgentId: undefined,
  adapterType: undefined,
  defaultModel: undefined,
};

interface UseAgentChatMetaParams {
  projectId?: string;
  agentInstanceId?: string;
  agentId?: string;
}

function normalizeMachineType(mt: string | undefined): "local" | "remote" {
  return mt === "remote" ? "remote" : "local";
}

function buildAgentChatMeta(agent: Agent | null | undefined): AgentChatMeta {
  if (!agent) return EMPTY_AGENT_CHAT_META;
  return {
    agentName: agent.name,
    machineType: normalizeMachineType(agent.machine_type),
    templateAgentId: agent.agent_id,
    adapterType: agent.adapter_type,
    defaultModel: agent.default_model,
  };
}

export function useStandaloneAgentMeta(agentId: string | undefined): AgentChatMeta {
  return useAgentStore(
    useShallow((state) => {
      if (!agentId) return EMPTY_AGENT_CHAT_META;
      const agent = state.agents.find((candidate) => candidate.agent_id === agentId);
      return buildAgentChatMeta(agent ?? null);
    }),
  );
}

/**
 * Unified metadata resolution for agent chat views.
 *
 * - Project mode: fetches AgentInstance from the API and extracts name,
 *   machine_type, and the template agent_id (needed for swarm API).
 * - Agent mode: reads from the agent store via useSelectedAgent().
 */
export function useAgentChatMeta(
  mode: ChatMode,
  params: UseAgentChatMetaParams,
): AgentChatMeta {
  const { selectedAgent } = useSelectedAgent();
  const routeAgentMeta = useStandaloneAgentMeta(params.agentId);
  const projectMetaQuery = useQuery({
    ...(mode === "project" && params.projectId && params.agentInstanceId
      ? projectAgentInstanceQueryOptions(params.projectId, params.agentInstanceId)
      : projectAgentInstanceQueryOptions("", "")),
    enabled: mode === "project" && Boolean(params.projectId && params.agentInstanceId),
    placeholderData: keepPreviousData,
  });

  if (mode === "project") {
    return {
      agentName: projectMetaQuery.data?.name,
      machineType: projectMetaQuery.data
        ? normalizeMachineType(projectMetaQuery.data.machine_type)
        : undefined,
      templateAgentId: projectMetaQuery.data?.agent_id,
      adapterType: projectMetaQuery.data?.adapter_type,
      defaultModel: projectMetaQuery.data?.default_model,
    };
  }

  return routeAgentMeta.agentName ? routeAgentMeta : buildAgentChatMeta(selectedAgent);
}
