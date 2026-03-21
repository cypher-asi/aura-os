import type { ReactNode } from "react";
import { ConnectionTaskbar } from "../../components/ConnectionTaskbar";
import { ResponsiveMainLane } from "../../components/ResponsiveMainLane";

export function AgentMainPanel({ children }: { children?: ReactNode }) {
  return (
    <ResponsiveMainLane taskbar={<ConnectionTaskbar />}>
      {children}
    </ResponsiveMainLane>
  );
}
