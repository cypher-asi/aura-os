import { useEffect, type ReactNode } from "react";
import { ConnectionTaskbar } from "../../components/ConnectionTaskbar";
import { ResponsiveMainLane } from "../../components/ResponsiveMainLane";
import { TerminalPanelHeader, TerminalPanelBody } from "../../components/TerminalPanel";
import { useTerminalPanelStore } from "../../stores/terminal-panel-store";
import { useProjectContext } from "../../stores/project-action-store";

export function ProjectMainPanel({ children }: { children?: ReactNode }) {
  const ctx = useProjectContext();
  const cwd = ctx?.project?.linked_folder_path;
  const setCwd = useTerminalPanelStore((s) => s.setCwd);

  useEffect(() => { setCwd(cwd); }, [cwd, setCwd]);

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
