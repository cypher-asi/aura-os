import { Outlet } from "react-router-dom";
import { Lane } from "../../components/Lane";

export function AgentMainPanel() {
  return (
    <Lane flex style={{ borderLeft: "1px solid var(--color-border)" }}>
      <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
        <Outlet />
      </main>
    </Lane>
  );
}
