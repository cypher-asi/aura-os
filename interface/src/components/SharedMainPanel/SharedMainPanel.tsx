import { useEffect, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { ResponsiveMainLane } from "../ResponsiveMainLane";
import { useTerminalPanelStore } from "../../stores/terminal-panel-store";
import { useTerminalTarget } from "../../hooks/use-terminal-target";

export function SharedMainPanel({ children }: { children?: ReactNode }) {
  const { projectId, agentInstanceId } = useParams<{ projectId: string; agentInstanceId: string }>();
  const setTerminalTarget = useTerminalPanelStore((s) => s.setTerminalTarget);

  const { remoteAgentId, workspacePath, status } = useTerminalTarget({ projectId, agentInstanceId });

  useEffect(() => {
    if (status !== "ready") return;
    setTerminalTarget({ cwd: workspacePath, remoteAgentId });
  }, [remoteAgentId, setTerminalTarget, status, workspacePath]);

  return (
    <ResponsiveMainLane>
      {children}
    </ResponsiveMainLane>
  );
}
