import { Navigate } from "react-router-dom";
import { Bot } from "lucide-react";
import { EmptyState } from "../../components/EmptyState";
import { useAgentApp } from "./AgentAppProvider";

export function AgentIndexRedirect() {
  const { agents, loading } = useAgentApp();

  if (loading) return null;

  if (agents.length === 0) {
    return <EmptyState icon={<Bot size={32} />}>No agents yet</EmptyState>;
  }

  const lastId = localStorage.getItem("aura:lastAgentId");
  const target = agents.find((a) => a.agent_id === lastId) ?? agents[0];
  return <Navigate to={`/agents/${target.agent_id}`} replace />;
}
