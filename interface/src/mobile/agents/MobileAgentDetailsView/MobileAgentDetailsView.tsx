import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { AgentInfoPanel } from "../../../apps/agents/AgentInfoPanel";
import { LAST_AGENT_ID_KEY, useAgents, useSelectedAgent } from "../../../apps/agents/stores";

export function MobileAgentDetailsView() {
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

  return <AgentInfoPanel variant="mobileStandalone" />;
}
