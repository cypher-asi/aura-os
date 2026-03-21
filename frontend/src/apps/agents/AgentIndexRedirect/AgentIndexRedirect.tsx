import { Navigate } from "react-router-dom";
import { Bot, Loader2 } from "lucide-react";
import { EmptyState } from "../../../components/EmptyState";
import { useAgents, LAST_AGENT_ID_KEY } from "../stores";
import styles from "./AgentIndexRedirect.module.css";

export function AgentIndexRedirect() {
  const { agents, status } = useAgents();
  const loading = status === "loading" || status === "idle";

  if (loading) {
    return (
      <EmptyState icon={<Loader2 size={32} className={styles.spinAnimation} />}>
        Loading agents...
      </EmptyState>
    );
  }

  const lastId = localStorage.getItem(LAST_AGENT_ID_KEY);
  const lastAgent = lastId ? agents.find((a) => a.agent_id === lastId) : null;
  if (lastAgent) {
    return <Navigate to={`/agents/${lastAgent.agent_id}`} replace />;
  }

  if (lastId) {
    localStorage.removeItem(LAST_AGENT_ID_KEY);
  }

  const target = agents[0];
  if (target) {
    return <Navigate to={`/agents/${target.agent_id}`} replace />;
  }

  return <EmptyState icon={<Bot size={32} />}>Add an agent to get started.</EmptyState>;
}
