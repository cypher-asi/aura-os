import { Drawer } from "@cypher-asi/zui";
import type { AgentInstance } from "../../../shared/types";
import styles from "./MobileProjectAgentSwitcherSheet.module.css";

export function MobileProjectAgentSwitcherSheet({
  isOpen,
  agents,
  currentAgentInstanceId,
  onClose,
  onSwitchAgent,
}: {
  isOpen: boolean;
  agents: AgentInstance[];
  currentAgentInstanceId: string;
  onClose: () => void;
  onSwitchAgent: (agentInstanceId: string) => void;
}) {
  if (!isOpen) return null;

  return (
    <Drawer
      side="bottom"
      isOpen
      onClose={onClose}
      title="Switch agent"
      className={styles.sheet}
      showMinimizedBar={false}
      defaultSize={360}
      maxSize={520}
    >
      <div className={styles.body}>
        <div className={styles.header}>
          <span className={styles.name}>Project agents</span>
          <span className={styles.meta}>Switch who you are chatting with.</span>
        </div>
        <div className={styles.list}>
          {agents.map((agent) => {
            const isCurrentAgent = agent.agent_instance_id === currentAgentInstanceId;
            return (
              <button
                key={agent.agent_instance_id}
                type="button"
                className={`${styles.row} ${isCurrentAgent ? styles.rowCurrent : ""}`}
                onClick={() => {
                  if (!isCurrentAgent) {
                    onSwitchAgent(agent.agent_instance_id);
                  }
                }}
                aria-label={isCurrentAgent ? `${agent.name}, current agent` : `Switch to ${agent.name}`}
                disabled={isCurrentAgent}
              >
                <span className={styles.copy}>
                  <span className={styles.name}>{agent.name}</span>
                  <span className={styles.meta}>{agent.role?.trim() || "Remote AURA agent"}</span>
                </span>
                {isCurrentAgent ? <span className={styles.status}>Current</span> : null}
              </button>
            );
          })}
        </div>
      </div>
    </Drawer>
  );
}
