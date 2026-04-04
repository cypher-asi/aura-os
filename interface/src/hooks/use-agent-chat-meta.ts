import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useAgentStore, useSelectedAgent } from "../apps/agents/stores";

type ChatMode = "project" | "agent";

export interface AgentChatMeta {
  agentName: string | undefined;
  machineType: "local" | "remote" | undefined;
  templateAgentId: string | undefined;
  adapterType: string | undefined;
  defaultModel: string | null | undefined;
}

interface UseAgentChatMetaParams {
  projectId?: string;
  agentInstanceId?: string;
  agentId?: string;
}

function normalizeMachineType(mt: string | undefined): "local" | "remote" {
  return mt === "remote" ? "remote" : "local";
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
  const routeAgent = useAgentStore((s) =>
    params.agentId ? s.agents.find((agent) => agent.agent_id === params.agentId) ?? null : null,
  );

  const [projectMeta, setProjectMeta] = useState<{
    name: string;
    machineType: "local" | "remote";
    templateAgentId: string;
    adapterType: string;
    defaultModel: string | null | undefined;
  } | null>(null);

  const loadIdRef = useRef(0);

  useEffect(() => {
    if (mode !== "project" || !params.projectId || !params.agentInstanceId) return;
    const loadId = ++loadIdRef.current;
    const controller = new AbortController();
    api
      .getAgentInstance(params.projectId, params.agentInstanceId, {
        signal: controller.signal,
      })
      .then((inst) => {
        if (loadId !== loadIdRef.current) return;
        setProjectMeta({
          name: inst.name,
          machineType: normalizeMachineType(inst.machine_type),
          templateAgentId: inst.agent_id,
          adapterType: inst.adapter_type,
          defaultModel: inst.default_model,
        });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
      });
    return () => {
      controller.abort();
    };
  }, [mode, params.projectId, params.agentInstanceId]);

  if (mode === "project") {
    return {
      agentName: projectMeta?.name,
      machineType: projectMeta?.machineType,
      templateAgentId: projectMeta?.templateAgentId,
      adapterType: projectMeta?.adapterType,
      defaultModel: projectMeta?.defaultModel,
    };
  }

  const resolvedAgent = routeAgent ?? selectedAgent;

  return {
    agentName: resolvedAgent?.name,
    machineType: resolvedAgent ? normalizeMachineType(resolvedAgent.machine_type) : undefined,
    templateAgentId: resolvedAgent?.agent_id,
    adapterType: resolvedAgent?.adapter_type,
    defaultModel: resolvedAgent?.default_model,
  };
}
