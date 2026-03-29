import { formatChatTime } from "../../../utils/format";
import type { Agent } from "../../../types";
import type { DisplaySessionEvent } from "../../../types/stream";
import { Avatar } from "../../../components/Avatar";
import { useAvatarState } from "../../../hooks/use-avatar-state";
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
  showMetadataOnly?: boolean;
  isSelected: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onMouseOver: (e: React.MouseEvent) => void;
}

export function AgentConversationRow({
  agent,
  lastMessage,
  showMetadataOnly = false,
  isSelected,
  onClick,
  onContextMenu,
  onMouseOver,
}: AgentConversationRowProps) {
  const agentRole = stripMarkdown(agent.role ?? "");
  const agentDescription = stripMarkdown(agent.personality ?? "");
  const messagePreview = lastMessage
    ? `${lastMessage.role === "user" ? "You: " : ""}${stripMarkdown(lastMessage.content)}`
    : "";
  const preview = showMetadataOnly
    ? agentDescription || "Open this agent"
    : agentDescription || messagePreview || "Open this agent";
  const { status, isLocal } = useAvatarState(agent.agent_id);

  return (
    <button
      id={agent.agent_id}
      className={`${styles.row} ${isSelected ? styles.selected : ""}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseOver={onMouseOver}
    >
      <Avatar
        avatarUrl={agent.icon ?? undefined}
        name={agent.name}
        type="agent"
        size={36}
        status={status}
        isLocal={isLocal}
        className={styles.avatar}
      />

      <span className={styles.body}>
        <span className={styles.top}>
          <span className={styles.name}>{agent.name}</span>
          <span className={styles.time}>{formatChatTime(agent.updated_at)}</span>
        </span>

        {showMetadataOnly && agentRole ? <span className={styles.role}>{agentRole}</span> : null}
        <span className={styles.preview}>{preview}</span>
      </span>
    </button>
  );
}
