import { useEffect, useState, useRef, useCallback } from "react";
import type { ProjectId, Agent, Session } from "../types";
import { api } from "../api/client";
import { useEventContext } from "../context/EventContext";
import { useSidekick } from "../context/SidekickContext";
import { useClickOutside } from "../hooks/use-click-outside";
import { StatusBadge } from "../components/StatusBadge";
import { Panel, Badge, Text, Item } from "@cypher-asi/zui";
import { ChevronDown } from "lucide-react";
import { formatRelativeTime } from "../utils/format";

interface AgentStatusBarProps {
  projectId: ProjectId;
}

export function AgentStatusBar({ projectId }: AgentStatusBarProps) {
  const { connected, subscribe } = useEventContext();
  const sidekick = useSidekick();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentTaskTitle, setCurrentTaskTitle] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useClickOutside(dropdownRef, () => setDropdownOpen(false), dropdownOpen);

  const fetchSessions = useCallback((agentId: string) => {
    api
      .listSessions(projectId, agentId)
      .then((s) => setSessions(s))
      .catch(console.error);
  }, [projectId]);

  useEffect(() => {
    api
      .listAgents(projectId)
      .then((agents) => {
        if (agents.length > 0) {
          setAgent(agents[0]);
          fetchSessions(agents[0].agent_id);
        }
      })
      .catch(console.error);
  }, [projectId, fetchSessions]);

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
        if (agent) fetchSessions(agent.agent_id);
      }),
      subscribe("loop_paused", () => {
        setCurrentTaskTitle(null);
      }),
      subscribe("loop_stopped", () => {
        setCurrentTaskTitle(null);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, agent, fetchSessions]);

  const sessionCount = sessions.length;

  const handleSessionClick = (session: Session) => {
    setDropdownOpen(false);
    sidekick.viewSession(session);
  };

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

      <div ref={dropdownRef} style={{ position: "relative", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <button
          onClick={() => setDropdownOpen((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-1)",
            background: "none",
            border: "none",
            cursor: sessionCount > 0 ? "pointer" : "default",
            padding: 0,
            color: "inherit",
          }}
          disabled={sessionCount === 0}
        >
          <Text variant="muted" size="sm" as="span">Session:</Text>
          <Text size="sm" as="span" weight="medium">#{sessionCount || 0}</Text>
          {sessionCount > 0 && <ChevronDown size={12} style={{ color: "var(--color-text-muted)", transform: dropdownOpen ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }} />}
        </button>
        {dropdownOpen && sessions.length > 0 && (
          <div style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 50,
            minWidth: 260,
            maxHeight: 320,
            overflowY: "auto",
            background: "var(--color-bg-secondary, #1a1a1a)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            padding: "var(--space-1) 0",
          }}>
            {[...sessions].reverse().map((session, idx) => {
              const num = sessions.length - idx;
              const taskCount = session.tasks_worked?.length ?? 0;
              return (
                <Item
                  key={session.session_id}
                  onClick={() => handleSessionClick(session)}
                  style={{ padding: "var(--space-2) var(--space-3)", cursor: "pointer", fontSize: 13 }}
                >
                  <Item.Label>
                    <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", width: "100%" }}>
                      <Text size="sm" weight="medium" as="span">#{num}</Text>
                      <StatusBadge status={session.status} />
                      <Text variant="muted" size="sm" as="span" style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
                        {taskCount} task{taskCount !== 1 ? "s" : ""} · {((session.total_input_tokens + session.total_output_tokens) / 1000).toFixed(1)}k tokens · {formatRelativeTime(session.started_at)}
                      </Text>
                    </span>
                  </Item.Label>
                </Item>
              );
            })}
          </div>
        )}
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
