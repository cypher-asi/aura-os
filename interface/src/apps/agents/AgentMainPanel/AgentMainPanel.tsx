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
      {/*
        This wrapper exists purely to carry `data-agent-surface` /
        `data-agent-agent-id` for changelog screenshot automation. It MUST
        participate in the flex-column height chain established by
        `ResponsiveMainLane`'s `.mainContent`, otherwise `ChatPanel`'s
        `.container { flex: 1; min-height: 0 }` has no bounded ancestor
        and the chat transcript's `overflow-y: auto` viewport collapses,
        killing wheel scrolling on the standalone agent chat. The project
        agent chat path uses `ProjectMainPanel`, which doesn't introduce
        this wrapper, which is why only the standalone chat regressed.
      */}
      <div
        data-agent-surface="agent-chat-panel"
        data-agent-context="agent-chat-product-context"
        data-agent-agent-id={agentId ?? ""}
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minWidth: 0,
          minHeight: 0,
        }}
      >
        {children ?? <AgentInfoPanel />}
      </div>
    </ResponsiveMainLane>
  );
}
