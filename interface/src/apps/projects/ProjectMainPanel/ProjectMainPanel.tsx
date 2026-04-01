import { useEffect, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { ResponsiveMainLane } from "../../../components/ResponsiveMainLane";
import { useTerminalPanelStore } from "../../../stores/terminal-panel-store";
import { useTerminalTarget } from "../../../hooks/use-terminal-target";

export function ProjectMainPanel({ children }: { children?: ReactNode }) {
  const { projectId, agentInstanceId } = useParams<{ projectId: string; agentInstanceId: string }>();
  const setCwd = useTerminalPanelStore((s) => s.setCwd);
  const setRemoteAgentId = useTerminalPanelStore((s) => s.setRemoteAgentId);

  const { remoteAgentId, workspacePath, status } = useTerminalTarget({ projectId, agentInstanceId });

  useEffect(() => { setCwd(workspacePath); }, [setCwd, workspacePath]);

  useEffect(() => {
    if (status !== "ready") return;
    setRemoteAgentId(remoteAgentId);
  }, [remoteAgentId, status, setRemoteAgentId]);

  return (
    <ResponsiveMainLane>
      {children}
    </ResponsiveMainLane>
  );
}
