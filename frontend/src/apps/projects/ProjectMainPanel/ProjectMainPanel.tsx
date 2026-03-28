import { useEffect, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { ConnectionTaskbar } from "../../../components/ConnectionTaskbar";
import { ResponsiveMainLane } from "../../../components/ResponsiveMainLane";
import { TerminalPanelHeader } from "../../../components/TerminalPanelHeader";
import { TerminalPanelBody } from "../../../components/TerminalPanelBody";
import { useTerminalPanelStore } from "../../../stores/terminal-panel-store";
import { useProjectContext } from "../../../stores/project-action-store";
import { useTerminalTarget } from "../../../hooks/use-terminal-target";

export function ProjectMainPanel({ children }: { children?: ReactNode }) {
  const { projectId, agentInstanceId } = useParams<{ projectId: string; agentInstanceId: string }>();
  const ctx = useProjectContext();
  const cwd = ctx?.project?.linked_folder_path;
  const setCwd = useTerminalPanelStore((s) => s.setCwd);
  const setRemoteAgentId = useTerminalPanelStore((s) => s.setRemoteAgentId);

  const { remoteAgentId, status } = useTerminalTarget({ projectId, agentInstanceId });

  useEffect(() => { setCwd(cwd); }, [cwd, setCwd]);

  useEffect(() => {
    if (status !== "ready") return;
    setRemoteAgentId(remoteAgentId);
  }, [remoteAgentId, status, setRemoteAgentId]);

  return (
    <ResponsiveMainLane
      taskbar={(
        <ConnectionTaskbar>
          <TerminalPanelHeader />
        </ConnectionTaskbar>
      )}
      footer={<TerminalPanelBody />}
    >
      {children}
    </ResponsiveMainLane>
  );
}
