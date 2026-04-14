export const CREATE_AGENT_CHAT_HANDOFF = "create-agent";

export interface AgentChatHandoffState {
  agentChatHandoff?: {
    type: typeof CREATE_AGENT_CHAT_HANDOFF;
  };
}

export function projectAgentHandoffTarget(projectId: string, agentInstanceId: string): string {
  return `project:${projectId}:${agentInstanceId}`;
}

export function standaloneAgentHandoffTarget(agentId: string): string {
  return `agent:${agentId}`;
}

export function createAgentChatHandoffState(): AgentChatHandoffState {
  return {
    agentChatHandoff: {
      type: CREATE_AGENT_CHAT_HANDOFF,
    },
  };
}

export function isCreateAgentChatHandoff(value: unknown): value is AgentChatHandoffState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const handoff = (value as AgentChatHandoffState).agentChatHandoff;
  return handoff?.type === CREATE_AGENT_CHAT_HANDOFF;
}
