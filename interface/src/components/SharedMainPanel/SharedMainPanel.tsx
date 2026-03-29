import { useEffect, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { ConnectionTaskbar } from "../ConnectionTaskbar";
import { ResponsiveMainLane } from "../ResponsiveMainLane";
import { TerminalPanelHeader } from "../TerminalPanelHeader";
import { TerminalPanelBody } from "../TerminalPanelBody";
import { useTerminalPanelStore } from "../../stores/terminal-panel-store";
import { useProjectContext } from "../../stores/project-action-store";
import { useTerminalTarget } from "../../hooks/use-terminal-target";

export function SharedMainPanel({ children }: { children?: ReactNode }) {
  const { projectId, agentInstanceId } = useParams<{ projectId: string; agentInstanceId: string }>();
  const ctx = useProjectContext();
  const cwd = ctx?.project?.linked_folder_path;
  const setCwd = useTerminalPanelStore((s) => s.setCwd);
  const setRemoteAgentId = useTerminalPanelStore((s) => s.setRemoteAgentId);

  const { remoteAgentId, remoteWorkspacePath, status } = useTerminalTarget({ projectId, agentInstanceId });
  const terminalCwd = remoteAgentId ? remoteWorkspacePath : cwd;

  useEffect(() => {
    setCwd(terminalCwd);
  }, [setCwd, terminalCwd]);

  useEffect(() => {
    if (status !== "ready") return;
    setRemoteAgentId(remoteAgentId);
  }, [remoteAgentId, status, setRemoteAgentId]);

  return (
    <ResponsiveMainLane
      taskbar={
        <ConnectionTaskbar>
          <TerminalPanelHeader />
        </ConnectionTaskbar>
      }
      footer={<TerminalPanelBody />}
    >
      {children}
    </ResponsiveMainLane>
  );
}
