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

  const lastId = getLastStandaloneAgentId();
  const lastAgent = lastId ? agents.find((a) => a.agent_id === lastId) : null;
  if (lastAgent) {
    return <Navigate to={`/agents/${lastAgent.agent_id}`} replace />;
  }

  if (lastId) {
    clearLastStandaloneAgentId();
  }

  const target = sortedAgents[0];
  if (target) {
    return <Navigate to={`/agents/${target.agent_id}`} replace />;
  }

  return <EmptyState icon={<Bot size={32} />}>Add an agent to get started.</EmptyState>;
}
