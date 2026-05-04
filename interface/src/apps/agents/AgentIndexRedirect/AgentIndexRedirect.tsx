import { Navigate } from "react-router-dom";
import { Bot, Loader2 } from "lucide-react";
import { PageEmptyState } from "@cypher-asi/zui";
import { EmptyState } from "../../../components/EmptyState";
import { useAuraCapabilities } from "../../../hooks/use-aura-capabilities";
import { clearLastStandaloneAgentId, getLastStandaloneAgentId } from "../../../utils/storage";
import { useAgents, useSortedAgents } from "../stores";

export function AgentIndexRedirect() {
  const { agents, status } = useAgents();
  const sortedAgents = useSortedAgents();
  const { isMobileLayout } = useAuraCapabilities();

  // Fast path: if we have a cached last-used agent id, redirect before
  // the `fetchAgents` network round-trip even completes. The downstream
  // `AgentChatView` can happily load its own history in parallel with
  // the agent list, so there's no reason to gate first paint on the
  // list coming back. If the cached id is stale (agent was deleted
  // remotely), the chat view will render an empty/error state and the
  // user can pick another agent from the sidebar — same fallback as
  // any other missing-agent navigation.
  const lastId = isMobileLayout ? null : getLastStandaloneAgentId();
  if (lastId) {
    return <Navigate to={`/agents/${lastId}`} replace />;
  }

  if (status === "idle" || status === "loading") {
    return (
      <PageEmptyState
        icon={<Loader2 size={32} className="animate-spin" aria-hidden />}
        title="Loading agents…"
      />
    );
  }

  if (isMobileLayout && agents.length > 0) {
    return (
      <EmptyState icon={<Bot size={32} />}>
        Select an agent from your library.
      </EmptyState>
    );
  }

  // `lastId` wasn't set (or was cleared above because the backing agent
  // no longer exists): fall back to the first sorted agent.
  if (getLastStandaloneAgentId()) {
    clearLastStandaloneAgentId();
  }

  const target = sortedAgents[0];
  if (target) {
    return <Navigate to={`/agents/${target.agent_id}`} replace />;
  }

  return <EmptyState icon={<Bot size={32} />}>Create your first AI agent to start chatting, automating tasks, and more.</EmptyState>;
}
