import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useSelectedAgent } from "../apps/agents/stores";

type ChatMode = "project" | "agent";

export interface AgentChatMeta {
  agentName: string | undefined;
  machineType: "local" | "remote" | undefined;
  templateAgentId: string | undefined;
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

  const [projectMeta, setProjectMeta] = useState<{
    name: string;
    machineType: "local" | "remote";
    templateAgentId: string;
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
    };
  }

  return {
    agentName: selectedAgent?.name,
    machineType: selectedAgent ? normalizeMachineType(selectedAgent.machine_type) : undefined,
    templateAgentId: selectedAgent?.agent_id,
  };
}
