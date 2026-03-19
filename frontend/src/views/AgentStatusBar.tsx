import { useEffect, useState, useRef, useCallback, type Dispatch, type SetStateAction } from "react";
import type { ProjectId, AgentInstance, Session } from "../types";
import { api } from "../api/client";
import { useEventContext } from "../context/EventContext";
import { useSidekick } from "../context/SidekickContext";
import { useClickOutside } from "../hooks/use-click-outside";
import { StatusBadge } from "../components/StatusBadge";
import { Panel, Badge, Text, Item } from "@cypher-asi/zui";
import { ChevronDown } from "lucide-react";
import { formatRelativeTime } from "../utils/format";

interface AgentEventSubscriptionParams {
  subscribe: ReturnType<typeof useEventContext>["subscribe"];
  projectId: ProjectId;
  isForProject: (event: { project_id?: string }) => boolean;
  selectedAgent: AgentInstance | null;
  fetchSessions: (agentInstanceId: string) => void;
  setAgents: Dispatch<SetStateAction<AgentInstance[]>>;
  setCurrentTaskTitles: Dispatch<SetStateAction<Record<string, string | null>>>;
}

function useAgentEventSubscriptions({
  subscribe, projectId, isForProject, selectedAgent,
  fetchSessions, setAgents, setCurrentTaskTitles,
}: AgentEventSubscriptionParams): void {
  useEffect(() => {
    const clearTaskTitle = (e: { project_id?: string; agent_instance_id?: string }) => {
      if (!isForProject(e)) return;
      const agentId = e.agent_instance_id;
      if (agentId) setCurrentTaskTitles((prev) => ({ ...prev, [agentId]: null }));
    };
    const unsubs = [
      subscribe("loop_started", (e) => {
        if (!isForProject(e)) return;
        api.listAgentInstances(projectId).then(setAgents).catch(console.error);
      }),
      subscribe("task_started", (e) => {
        if (!isForProject(e)) return;
        const agentId = e.agent_instance_id;
        if (agentId && e.task_title) {
          setCurrentTaskTitles((prev) => ({ ...prev, [agentId]: e.task_title ?? null }));
        }
      }),
      subscribe("task_completed", clearTaskTitle),
      subscribe("task_failed", clearTaskTitle),
      subscribe("session_rolled_over", (e) => {
        if (!isForProject(e)) return;
        if (selectedAgent) fetchSessions(selectedAgent.agent_instance_id);
      }),
      subscribe("loop_paused", clearTaskTitle),
      subscribe("loop_stopped", clearTaskTitle),
      subscribe("loop_finished", clearTaskTitle),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, selectedAgent, fetchSessions, isForProject, projectId, setAgents, setCurrentTaskTitles]);
}

interface AgentStatusBarProps {
  projectId: ProjectId;
}

export function AgentStatusBar({ projectId }: AgentStatusBarProps) {
  const { connected, subscribe } = useEventContext();
  const sidekick = useSidekick();
  const [agents, setAgents] = useState<AgentInstance[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentTaskTitles, setCurrentTaskTitles] = useState<Record<string, string | null>>({});
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useClickOutside(dropdownRef, () => setDropdownOpen(false), dropdownOpen);

  const selectedAgent = agents.find((a) => a.agent_instance_id === selectedAgentId) ?? agents[0] ?? null;

  const fetchSessions = useCallback((agentInstanceId: string) => {
    api
      .listSessions(projectId, agentInstanceId)
      .then((s) => setSessions(s))
      .catch(console.error);
  }, [projectId]);

  useEffect(() => {
    api
      .listAgentInstances(projectId)
      .then((list) => {
        setAgents(list);
        if (list.length > 0 && !selectedAgentId) {
          setSelectedAgentId(list[0].agent_instance_id);
          fetchSessions(list[0].agent_instance_id);
        }
      })
      .catch(console.error);
  }, [projectId, fetchSessions, selectedAgentId]);

  useEffect(() => {
    if (selectedAgent) {
      fetchSessions(selectedAgent.agent_instance_id);
    }
  }, [selectedAgent?.agent_instance_id, fetchSessions]);

  const isForProject = useCallback(
    (event: { project_id?: string }) => event.project_id === projectId,
    [projectId],
  );

  useAgentEventSubscriptions({
    subscribe, projectId, isForProject, selectedAgent,
    fetchSessions, setAgents, setCurrentTaskTitles,
  });

  const sessionCount = sessions.length;
  const currentTaskTitle = selectedAgent
    ? currentTaskTitles[selectedAgent.agent_instance_id] ?? null
    : null;

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
        {agents.length <= 1 ? (
          <>
            <Text size="sm" as="span" weight="medium">{selectedAgent?.name || "—"}</Text>
            {selectedAgent && <StatusBadge status={selectedAgent.status} />}
          </>
        ) : (
          <select
            value={selectedAgent?.agent_instance_id ?? ""}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            style={{
              background: "var(--color-bg-tertiary, #2a2a2a)",
              border: "1px solid var(--color-border)",
              borderRadius: 4,
              color: "inherit",
              fontSize: 13,
              padding: "2px 6px",
            }}
          >
            {agents.map((a) => (
              <option key={a.agent_instance_id} value={a.agent_instance_id}>
                {a.name} ({a.status})
              </option>
            ))}
          </select>
        )}
        {agents.length > 1 && (
          <Text variant="muted" size="xs" as="span">
            {agents.filter((a) => a.status === "working").length}/{agents.length} active
          </Text>
        )}
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
