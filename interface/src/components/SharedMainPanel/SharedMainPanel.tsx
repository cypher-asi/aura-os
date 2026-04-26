import { useEffect, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useTerminalPanelStore } from "../../stores/terminal-panel-store";
import { useTerminalTarget } from "../../hooks/use-terminal-target";

// The shell (`DesktopShell`) now provides a persistent `ResponsiveMainLane`
// around every app's `MainPanel`, so this component is just a side-effect
// host for terminal targeting. It returns its children verbatim — the visible
// container is owned by the shell and stays mounted across app switches.
export function SharedMainPanel({ children }: { children?: ReactNode }) {
  const { projectId, agentInstanceId } = useParams<{ projectId: string; agentInstanceId: string }>();
  const setTerminalTarget = useTerminalPanelStore((s) => s.setTerminalTarget);

  const { remoteAgentId, workspacePath, status } = useTerminalTarget({ projectId, agentInstanceId });

  useEffect(() => {
    if (status !== "ready") return;
    setTerminalTarget({ cwd: workspacePath, remoteAgentId });
  }, [remoteAgentId, setTerminalTarget, status, workspacePath]);

  return <>{children}</>;
}
