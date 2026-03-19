import { Outlet } from "react-router-dom";
import { ConnectionTaskbar } from "../../components/ConnectionTaskbar";
import { ResponsiveMainLane } from "../../components/ResponsiveMainLane";

export function AgentMainPanel() {
  return (
    <ResponsiveMainLane taskbar={<ConnectionTaskbar />}>
      <Outlet />
    </ResponsiveMainLane>
  );
}
