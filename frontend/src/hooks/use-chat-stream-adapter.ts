import { useChatStream } from "./use-chat-stream";
import { useAgentChatStream } from "./use-agent-chat-stream";

type ChatMode = "project" | "agent";

interface AdapterParams {
  projectId?: string;
  agentInstanceId?: string;
  agentId?: string;
}

/**
 * Calls both stream hooks unconditionally (Rules of Hooks) but only
 * the active mode's hook receives real IDs — the other gets `undefined`
 * and stays inert.
 */
export function useChatStreamAdapter(mode: ChatMode, params: AdapterParams) {
  const projectStream = useChatStream({
    projectId: mode === "project" ? params.projectId : undefined,
    agentInstanceId: mode === "project" ? params.agentInstanceId : undefined,
  });

  const agentStream = useAgentChatStream({
    agentId: mode === "agent" ? params.agentId : undefined,
  });

  return mode === "project" ? projectStream : agentStream;
}
