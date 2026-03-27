import { useEffect, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { ConnectionTaskbar } from "../../../components/ConnectionTaskbar";
import { ResponsiveMainLane } from "../../../components/ResponsiveMainLane";
import { TerminalPanelHeader } from "../../../components/TerminalPanelHeader";
import { TerminalPanelBody } from "../../../components/TerminalPanelBody";
import { useTerminalPanelStore } from "../../../stores/terminal-panel-store";
import { AgentInfoPanel } from "../AgentInfoPanel";
import { LAST_AGENT_ID_KEY, useAgents, useSelectedAgent } from "../stores";

export function AgentMainPanel({ children }: { children?: ReactNode }) {
  const { agentId } = useParams<{ agentId: string }>();
  const { fetchAgents } = useAgents();
  const { setSelectedAgent, selectedAgent } = useSelectedAgent();
  const setRemoteAgentId = useTerminalPanelStore((s) => s.setRemoteAgentId);

  useEffect(() => {
    fetchAgents().catch(() => {});
  }, [fetchAgents]);

  useEffect(() => {
    setSelectedAgent(agentId ?? null);
    if (agentId) {
      localStorage.setItem(LAST_AGENT_ID_KEY, agentId);
    }
  }, [agentId, setSelectedAgent]);

  const { status } = useAgents();

  useEffect(() => {
    if (status !== "ready") return;
    const isRemote = selectedAgent?.machine_type === "remote";
    setRemoteAgentId(isRemote ? selectedAgent?.agent_id : undefined);
  }, [selectedAgent, status, setRemoteAgentId]);

  return (
    <ResponsiveMainLane
      taskbar={
        <ConnectionTaskbar>
          <TerminalPanelHeader />
        </ConnectionTaskbar>
      }
      footer={<TerminalPanelBody />}
    >
      {children ?? <AgentInfoPanel />}
    </ResponsiveMainLane>
  );
}
