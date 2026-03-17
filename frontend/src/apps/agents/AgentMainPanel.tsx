import { Outlet, useNavigate, useParams } from "react-router-dom";
import { Text } from "@cypher-asi/zui";
import { Lane } from "../../components/Lane";
import { ConnectionDot } from "../../components/ConnectionDot";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useAgentApp } from "./AgentAppProvider";
import styles from "./AgentMainPanel.module.css";

function MobileAgentHeader() {
  const { agents, loading, selectedAgent } = useAgentApp();
  const navigate = useNavigate();
  const { agentId } = useParams();

  const activeAgent =
    (agentId ? agents.find((agent) => agent.agent_id === agentId) : null) ??
    (selectedAgent?.agent_id === agentId ? selectedAgent : null) ??
    selectedAgent ??
    agents[0] ??
    null;

  const selectedAgentId = activeAgent?.agent_id ?? agentId ?? "";
  const secondaryLabel = loading
    ? "Loading agents"
    : activeAgent?.role
      ? `${activeAgent.role} / Global agent chat`
      : agents.length > 0
        ? `${agents.length} agent${agents.length === 1 ? "" : "s"} available`
        : "Global agent chat";

  return (
    <div className={styles.mobileHeader}>
      <div className={styles.identityRow}>
        <ConnectionDot />
        <div className={styles.identityCopy}>
          <Text size="sm" weight="medium" className={styles.title}>
            {activeAgent?.name ?? "Agents"}
          </Text>
          <Text variant="muted" size="xs" className={styles.subtitle}>
            {secondaryLabel}
          </Text>
        </div>
      </div>

      <div className={styles.metaRow}>
        {activeAgent?.role && <span className={styles.metaChip}>{activeAgent.role}</span>}
        <span className={styles.metaChip}>
          {loading ? "Loading..." : `${agents.length} agent${agents.length === 1 ? "" : "s"} available`}
        </span>
      </div>

      {agents.length > 1 && (
        <div>
          <div className={styles.selectLabel}>Switch agent</div>
          <select
            aria-label="Choose agent"
            value={selectedAgentId}
            onChange={(event) => navigate(`/agents/${event.target.value}`)}
            className={styles.select}
          >
            {agents.map((agent) => (
              <option key={agent.agent_id} value={agent.agent_id}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

export function AgentMainPanel() {
  const { supportsDesktopWorkspace } = useAuraCapabilities();

  if (!supportsDesktopWorkspace) {
    return (
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <MobileAgentHeader />
        <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <Lane
      flex
      style={{ borderLeft: "1px solid var(--color-border)" }}
      taskbar={
        <div style={{ display: "flex", flex: 1, minWidth: 0, alignItems: "stretch" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              paddingLeft: "var(--space-3)",
              paddingRight: "var(--space-2)",
              flexShrink: 0,
            }}
          >
            <ConnectionDot />
          </div>
        </div>
      }
    >
      <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
        <Outlet />
      </main>
    </Lane>
  );
}
