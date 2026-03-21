import { Navigate } from "react-router-dom";
import { Bot, Loader2 } from "lucide-react";
import { EmptyState } from "../../components/EmptyState";
import { useAgents, LAST_AGENT_ID_KEY } from "./stores";

export function AgentIndexRedirect() {
  const { agents, status } = useAgents();
  const loading = status === "loading";
  const lastId = localStorage.getItem(LAST_AGENT_ID_KEY);

  if (lastId) {
    return <Navigate to={`/agents/${lastId}`} replace />;
  }

  const target = agents[0];
  if (target) {
    return <Navigate to={`/agents/${target.agent_id}`} replace />;
  }

  if (loading) {
    return (
      <EmptyState icon={<Loader2 size={32} style={{ animation: "spin 1s linear infinite" }} />}>
        Loading agents...
      </EmptyState>
    );
  }

  if (agents.length === 0) {
    return <EmptyState icon={<Bot size={32} />}>Add an agent to get started.</EmptyState>;
  }
  return null;
}
