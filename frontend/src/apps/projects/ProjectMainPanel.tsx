import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { Tabs, Text } from "@cypher-asi/zui";
import { Lane } from "../../components/Lane";
import { ConnectionDot } from "../../components/ConnectionDot";
import { TerminalPanelHeader, TerminalPanelBody } from "../../components/TerminalPanel";
import { TerminalPanelProvider } from "../../context/TerminalPanelContext";
import { useProjectContext } from "../../context/ProjectContext";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { api } from "../../api/client";
import type { AgentInstance } from "../../types";

const MOBILE_PROJECT_TABS = [
  { id: "chat", label: "Chat" },
  { id: "execution", label: "Execution" },
];

function MobileProjectHeader() {
  const ctx = useProjectContext();
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId, agentInstanceId } = useParams();
  const [agents, setAgents] = useState<AgentInstance[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);

  const project = ctx?.project;
  const isExecutionRoute = location.pathname.endsWith("/execution");
  const hasChatTarget = Boolean(agentInstanceId) || agents.length > 0;
  const selectedTab = isExecutionRoute ? "execution" : hasChatTarget ? "chat" : "execution";
  const selectedAgentId = agentInstanceId ?? agents[0]?.agent_instance_id ?? "";

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoadingAgents(true);

    api.listAgentInstances(projectId)
      .then((next) => {
        if (!cancelled) {
          setAgents(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAgents([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingAgents(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId || isExecutionRoute || agentInstanceId || loadingAgents) return;

    if (agents.length > 0) {
      navigate(`/projects/${projectId}/agents/${agents[0].agent_instance_id}`, { replace: true });
      return;
    }

    navigate(`/projects/${projectId}/execution`, { replace: true });
  }, [agentInstanceId, agents, isExecutionRoute, loadingAgents, navigate, projectId]);

  const tabs = hasChatTarget ? MOBILE_PROJECT_TABS : MOBILE_PROJECT_TABS.filter((tab) => tab.id === "execution");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
        padding: "var(--space-3)",
        borderLeft: "1px solid var(--color-border)",
        borderBottom: "1px solid var(--color-border)",
        background: "rgba(255, 255, 255, 0.02)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
        <ConnectionDot />
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <Text size="sm" weight="medium" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {project?.name ?? "Aura Companion"}
          </Text>
          <Text variant="muted" size="xs">
            {agents.length > 0 ? `${agents.length} agent${agents.length === 1 ? "" : "s"}` : "Execution companion"}
          </Text>
        </div>
      </div>

      <Tabs
        tabs={tabs}
        value={selectedTab}
        onChange={(tabId) => {
          if (!projectId) return;
          if (tabId === "execution") {
            navigate(`/projects/${projectId}/execution`);
            return;
          }
          if (selectedAgentId) {
            navigate(`/projects/${projectId}/agents/${selectedAgentId}`);
          }
        }}
        size="sm"
      />

      {agents.length > 1 && !isExecutionRoute && (
        <select
          value={selectedAgentId}
          onChange={(event) => {
            if (!projectId) return;
            navigate(`/projects/${projectId}/agents/${event.target.value}`);
          }}
          style={{
            width: "100%",
            background: "var(--color-bg-tertiary, #2a2a2a)",
            border: "1px solid var(--color-border)",
            borderRadius: 6,
            color: "inherit",
            fontSize: 13,
            padding: "8px 10px",
          }}
        >
          {agents.map((agent) => (
            <option key={agent.agent_instance_id} value={agent.agent_instance_id}>
              {agent.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function ProjectMainPanel() {
  const ctx = useProjectContext();
  const cwd = ctx?.project?.linked_folder_path;
  const { supportsDesktopWorkspace } = useAuraCapabilities();

  if (!supportsDesktopWorkspace) {
    return (
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <MobileProjectHeader />
        <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <TerminalPanelProvider cwd={cwd}>
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
            <TerminalPanelHeader />
          </div>
        }
        footer={<TerminalPanelBody />}
      >
        <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
          <Outlet />
        </main>
      </Lane>
    </TerminalPanelProvider>
  );
}
