import { Navigate } from "react-router-dom";
import { Text } from "@cypher-asi/zui";
import { Bot } from "lucide-react";
import { useAgentApp } from "./AgentAppProvider";

export function AgentIndexRedirect() {
  const { agents, loading } = useAgentApp();

  if (loading) return null;

  if (agents.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "var(--space-3)" }}>
        <Bot size={32} style={{ opacity: 0.3 }} />
        <Text variant="muted" size="sm">No agents yet</Text>
      </div>
    );
  }

  const last = agents[agents.length - 1];
  return <Navigate to={`/agents/${last.agent_id}`} replace />;
}
