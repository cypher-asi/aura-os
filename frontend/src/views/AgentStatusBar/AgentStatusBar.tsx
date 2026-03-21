import type { ProjectId, Session } from "../../types";
import { StatusBadge } from "../../components/StatusBadge";
import { Panel, Badge, Text, Item } from "@cypher-asi/zui";
import { ChevronDown } from "lucide-react";
import { formatRelativeTime } from "../../utils/format";
import { useAgentStatusBarData } from "./useAgentStatusBarData";

interface AgentStatusBarProps {
  projectId: ProjectId;
}

export function AgentStatusBar({ projectId }: AgentStatusBarProps) {
  const {
    connected, agents, selectedAgent, sessions, currentTaskTitle,
    dropdownOpen, setDropdownOpen, dropdownRef, sessionCount,
    setSelectedAgentId, handleSessionClick,
  } = useAgentStatusBarData(projectId);

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
              borderRadius: 4, color: "inherit", fontSize: 13, padding: "2px 6px",
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

      <SessionDropdown
        dropdownRef={dropdownRef}
        dropdownOpen={dropdownOpen}
        setDropdownOpen={setDropdownOpen}
        sessionCount={sessionCount}
        sessions={sessions}
        onSessionClick={handleSessionClick}
      />

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

function SessionDropdown({
  dropdownRef, dropdownOpen, setDropdownOpen, sessionCount, sessions, onSessionClick,
}: {
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  dropdownOpen: boolean;
  setDropdownOpen: (v: boolean) => void;
  sessionCount: number;
  sessions: Session[];
  onSessionClick: (s: Session) => void;
}) {
  return (
    <div ref={dropdownRef} style={{ position: "relative", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        style={{
          display: "flex", alignItems: "center", gap: "var(--space-1)",
          background: "none", border: "none",
          cursor: sessionCount > 0 ? "pointer" : "default",
          padding: 0, color: "inherit",
        }}
        disabled={sessionCount === 0}
      >
        <Text variant="muted" size="sm" as="span">Session:</Text>
        <Text size="sm" as="span" weight="medium">#{sessionCount || 0}</Text>
        {sessionCount > 0 && <ChevronDown size={12} style={{ color: "var(--color-text-muted)", transform: dropdownOpen ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }} />}
      </button>
      {dropdownOpen && sessions.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50,
          minWidth: 260, maxHeight: 320, overflowY: "auto",
          background: "var(--color-bg-secondary, #1a1a1a)",
          border: "1px solid var(--color-border)", borderRadius: 8,
          boxShadow: "0 4px 16px rgba(0,0,0,0.3)", padding: "var(--space-1) 0",
        }}>
          {[...sessions].reverse().map((session, idx) => {
            const num = sessions.length - idx;
            const taskCount = session.tasks_worked?.length ?? 0;
            return (
              <Item
                key={session.session_id}
                onClick={() => onSessionClick(session)}
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
  );
}
