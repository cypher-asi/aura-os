import { useEffect, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { ResponsiveMainLane } from "../../../components/ResponsiveMainLane";
import { useTerminalPanelStore } from "../../../stores/terminal-panel-store";
import { AgentInfoPanel } from "../AgentInfoPanel";
import { setLastStandaloneAgentId } from "../../../utils/storage";
import { useAgents, useSelectedAgent } from "../stores";
import { useTerminalTarget } from "../../../hooks/use-terminal-target";

export function AgentMainPanel({ children }: { children?: ReactNode }) {
  const { agentId } = useParams<{ agentId: string }>();
  const { fetchAgents, status: agentsStatus } = useAgents();
  const { setSelectedAgent, selectedAgent } = useSelectedAgent();
  const setTerminalTarget = useTerminalPanelStore((s) => s.setTerminalTarget);

  useEffect(() => {
    fetchAgents().catch(() => {});
  }, [fetchAgents]);

  useEffect(() => {
    setSelectedAgent(agentId ?? null);
    if (agentId) {
      setLastStandaloneAgentId(agentId);
    }
  }, [agentId, setSelectedAgent]);

  const { remoteAgentId, status } = useTerminalTarget({
    agentId,
    selectedAgent,
    agentsStatus,
  });

  useEffect(() => {
    if (status !== "ready") return;
    setTerminalTarget({ cwd: undefined, remoteAgentId });
  }, [remoteAgentId, setTerminalTarget, status]);

  return (
    <ResponsiveMainLane>
      {children ?? <AgentInfoPanel />}
    </ResponsiveMainLane>
  );
}
