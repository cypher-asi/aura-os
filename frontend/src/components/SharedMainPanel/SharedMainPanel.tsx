import { useEffect, type ReactNode } from "react";
import { ConnectionTaskbar } from "../ConnectionTaskbar";
import { ResponsiveMainLane } from "../ResponsiveMainLane";
import { TerminalPanelHeader } from "../TerminalPanelHeader";
import { TerminalPanelBody } from "../TerminalPanelBody";
import { useTerminalPanelStore } from "../../stores/terminal-panel-store";
import { useProjectContext } from "../../stores/project-action-store";
import { useProjectTerminalMode } from "../../hooks/use-project-terminal-mode";

export function SharedMainPanel({ children }: { children?: ReactNode }) {
  const ctx = useProjectContext();
  const cwd = ctx?.project?.linked_folder_path;
  const projectId = ctx?.project?.project_id;
  const setCwd = useTerminalPanelStore((s) => s.setCwd);
  const setRemoteAgentId = useTerminalPanelStore((s) => s.setRemoteAgentId);

  const { remoteAgentId, resolved } = useProjectTerminalMode(projectId);

  useEffect(() => {
    setCwd(cwd);
  }, [cwd, setCwd]);

  useEffect(() => {
    if (resolved) setRemoteAgentId(remoteAgentId);
  }, [remoteAgentId, resolved, setRemoteAgentId]);

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
