import { useEffect, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { ResponsiveMainLane } from "../../../components/ResponsiveMainLane";
import { AgentInfoPanel } from "../AgentInfoPanel";
import { LAST_AGENT_ID_KEY, useAgents, useSelectedAgent } from "../stores";

export function AgentMainPanel({ children }: { children?: ReactNode }) {
  const { agentId } = useParams<{ agentId: string }>();
  const { fetchAgents } = useAgents();
  const { setSelectedAgent } = useSelectedAgent();

  useEffect(() => {
    fetchAgents().catch(() => {});
  }, [fetchAgents]);

  useEffect(() => {
    setSelectedAgent(agentId ?? null);
    if (agentId) {
      localStorage.setItem(LAST_AGENT_ID_KEY, agentId);
    }
  }, [agentId, setSelectedAgent]);

  return (
    <ResponsiveMainLane>
      {children ?? <AgentInfoPanel />}
    </ResponsiveMainLane>
  );
}
