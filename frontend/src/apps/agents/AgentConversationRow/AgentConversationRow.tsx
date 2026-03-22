import { Bot } from "lucide-react";
import type { Agent } from "../../../types";
import styles from "./AgentConversationRow.module.css";

function summarizeAgent(agent: Agent): string {
  const summary = agent.personality?.trim() || agent.system_prompt?.trim() || "";
  if (!summary) {
    return "Open this agent to review its role, skills, and instructions.";
  }
  return summary.replace(/\s+/g, " ").slice(0, 96);
}

interface AgentConversationRowProps {
  agent: Agent;
  isSelected: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export function AgentConversationRow({
  agent,
  isSelected,
  onClick,
  onContextMenu,
}: AgentConversationRowProps) {
  const preview = summarizeAgent(agent);

  return (
    <button
      id={agent.agent_id}
      className={`${styles.row} ${isSelected ? styles.selected : ""}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <span className={styles.avatar}>
        {agent.icon ? (
          <img src={agent.icon} alt="" className={styles.avatarImg} />
        ) : (
          <Bot size={20} />
        )}
      </span>

      <span className={styles.body}>
        <span className={styles.top}>
          <span className={styles.name}>{agent.name}</span>
          <span className={styles.role}>{agent.role || "Agent"}</span>
        </span>
        <span className={styles.preview}>{preview}</span>
      </span>
    </button>
  );
}
