import { Outlet } from "react-router-dom";
import { ConnectionTaskbar } from "../../components/ConnectionTaskbar";
import { ResponsiveMainLane } from "../../components/ResponsiveMainLane";
import { TerminalPanelHeader, TerminalPanelBody } from "../../components/TerminalPanel";
import { TerminalPanelProvider } from "../../context/TerminalPanelContext";
import { useProjectContext } from "../../context/ProjectContext";

export function ProjectMainPanel() {
  const ctx = useProjectContext();
  const cwd = ctx?.project?.linked_folder_path;

  return (
    <TerminalPanelProvider cwd={cwd}>
      <ResponsiveMainLane
        taskbar={(
          <ConnectionTaskbar>
            <TerminalPanelHeader />
          </ConnectionTaskbar>
        )}
        footer={<TerminalPanelBody />}
      >
        <Outlet />
      </ResponsiveMainLane>
    </TerminalPanelProvider>
  );
}
