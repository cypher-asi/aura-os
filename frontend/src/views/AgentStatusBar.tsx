import { useEffect, useState } from "react";
import type { ProjectId, Agent, Session } from "../types";
import { api } from "../api/client";
import { useEventContext } from "../context/EventContext";
import { StatusBadge } from "../components/StatusBadge";
import { Panel, Badge, Text } from "@cypher-asi/zui";

interface AgentStatusBarProps {
  projectId: ProjectId;
}

export function AgentStatusBar({ projectId }: AgentStatusBarProps) {
  const { connected, subscribe } = useEventContext();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [currentTaskTitle, setCurrentTaskTitle] = useState<string | null>(null);

  useEffect(() => {
    api
      .listAgents(projectId)
      .then((agents) => {
        if (agents.length > 0) {
          setAgent(agents[0]);
          api
            .listSessions(projectId, agents[0].agent_id)
            .then((sessions: Session[]) => setSessionCount(sessions.length));
        }
      })
      .catch(console.error);
  }, [projectId]);

  useEffect(() => {
    const unsubs = [
      subscribe("task_started", (e) => {
        setCurrentTaskTitle(e.task_title || null);
      }),
      subscribe("task_completed", () => {
        setCurrentTaskTitle(null);
      }),
      subscribe("task_failed", () => {
        setCurrentTaskTitle(null);
      }),
      subscribe("session_rolled_over", () => {
        setSessionCount((c) => c + 1);
      }),
      subscribe("loop_paused", () => {
        setCurrentTaskTitle(null);
      }),
      subscribe("loop_stopped", () => {
        setCurrentTaskTitle(null);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe]);

  return (
    <Panel variant="solid" border="solid" style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", padding: "var(--space-3) var(--space-4)", flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <Badge variant={connected ? "running" : "error"} pulse={connected}>
          {connected ? "Connected" : "Disconnected"}
        </Badge>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <Text variant="muted" size="sm" as="span">Agent:</Text>
        <Text size="sm" as="span" weight="medium">{agent?.name || "—"}</Text>
        {agent && <StatusBadge status={agent.status} />}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <Text variant="muted" size="sm" as="span">Session:</Text>
        <Text size="sm" as="span" weight="medium">#{sessionCount || 0}</Text>
      </div>

      <div style={{ marginLeft: "auto" }}>
        {currentTaskTitle ? (
          <Text size="sm" as="span">
            <Text variant="muted" size="sm" as="span">Working on: </Text>
            {currentTaskTitle}
          </Text>
        ) : (
          <Text variant="muted" size="sm" as="span">Idle</Text>
        )}
      </div>
    </Panel>
  );
}
