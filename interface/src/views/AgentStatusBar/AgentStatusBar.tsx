import type { ProjectId, Session } from "../../types";
import { StatusBadge } from "../../components/StatusBadge";
import { Panel, Badge, Text, Item } from "@cypher-asi/zui";
import { ChevronDown } from "lucide-react";
import { formatRelativeTime } from "../../utils/format";
import { useAgentStatusBarData } from "./useAgentStatusBarData";
import styles from "./AgentStatusBar.module.css";

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
    <Panel variant="solid" border="solid" className={styles.statusBar}>
      <div className={styles.inlineRow}>
        <Badge variant={connected ? "running" : "error"} pulse={connected}>
          {connected ? "Connected" : "Disconnected"}
        </Badge>
      </div>

      <div className={styles.inlineRow}>
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
            className={styles.agentSelect}
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

      <div className={styles.autoRight}>
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
    <div ref={dropdownRef} className={styles.dropdownWrap}>
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className={styles.sessionButton}
        style={{ cursor: sessionCount > 0 ? "pointer" : "default" }}
        disabled={sessionCount === 0}
      >
        <Text variant="muted" size="sm" as="span">Session:</Text>
        <Text size="sm" as="span" weight="medium">#{sessionCount || 0}</Text>
        {sessionCount > 0 && <ChevronDown size={12} className={styles.chevronMuted} style={{ transform: dropdownOpen ? "rotate(180deg)" : undefined }} />}
      </button>
      {dropdownOpen && sessions.length > 0 && (
        <div className={styles.sessionDropdown}>
          {[...sessions].reverse().map((session, idx) => {
            const num = sessions.length - idx;
            const taskCount = session.tasks_worked?.length ?? 0;
            return (
              <Item
                key={session.session_id}
                onClick={() => onSessionClick(session)}
                className={styles.sessionItem}
              >
                <Item.Label>
                  <span className={styles.sessionLabel}>
                    <Text size="sm" weight="medium" as="span">#{num}</Text>
                    <StatusBadge status={session.status} />
                    <Text variant="muted" size="sm" as="span" className={styles.sessionMeta}>
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
