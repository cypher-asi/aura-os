import { Bot } from "lucide-react";
import { formatChatTime } from "../../../utils/format";
import type { Agent } from "../../../types";
import type { DisplaySessionEvent } from "../../../types/stream";
import styles from "./AgentConversationRow.module.css";

function stripMarkdown(text: string): string {
  return text
    .replace(/[*_~`#>]+/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\n+/g, " ")
    .trim();
}

interface AgentConversationRowProps {
  agent: Agent;
  lastMessage: DisplaySessionEvent | undefined;
  isSelected: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onMouseOver: (e: React.MouseEvent) => void;
}

export function AgentConversationRow({
  agent,
  lastMessage,
  isSelected,
  onClick,
  onContextMenu,
  onMouseOver,
}: AgentConversationRowProps) {
  const preview = lastMessage
    ? `${lastMessage.role === "user" ? "You: " : ""}${stripMarkdown(lastMessage.content)}`
    : agent.role;

  return (
    <button
      id={agent.agent_id}
      className={`${styles.row} ${isSelected ? styles.selected : ""}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseOver={onMouseOver}
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
          <span className={styles.time}>{formatChatTime(agent.updated_at)}</span>
        </span>
        <span className={styles.preview}>{preview}</span>
      </span>
    </button>
  );
}
