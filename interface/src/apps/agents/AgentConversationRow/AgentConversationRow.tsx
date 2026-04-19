import { Pin } from "lucide-react";
import { formatChatTime } from "../../../utils/format";
import type { Agent } from "../../../types";
import { isSuperAgent } from "../../../types/permissions";
import type { DisplaySessionEvent } from "../../../types/stream";
import { Avatar } from "../../../components/Avatar";
import { useAvatarState } from "../../../hooks/use-avatar-state";
import { useAgentStore } from "../stores";
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
  onMouseEnter: () => void;
}

export function AgentConversationRow({
  agent,
  lastMessage,
  showMetadataOnly = false,
  isSelected,
  onClick,
  onContextMenu,
  onMouseEnter,
}: AgentConversationRowProps) {
  const agentRole = stripMarkdown(agent.role ?? "");
  const agentDescription = stripMarkdown(agent.personality ?? "");
  const messagePreview = lastMessage
    ? `${lastMessage.role === "user" ? "You: " : ""}${stripMarkdown(lastMessage.content)}`
    : "";
  const fallback = agentRole || "Open this agent";
  const preview = showMetadataOnly
    ? agentDescription || fallback
    : messagePreview || agentDescription || fallback;
  const { status, isLocal } = useAvatarState(agent.agent_id);
  const pinnedIds = useAgentStore((s) => s.pinnedAgentIds);
  const isPinned = agent.is_pinned || pinnedIds.has(agent.agent_id);
  const isCeo = isSuperAgent(agent);

  return (
    <button
      id={agent.agent_id}
      className={`${styles.row} ${isSelected ? styles.selected : ""}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
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
          <span className={styles.name}>
            {agent.name}
            {isCeo && <span className={styles.ceoBadge}>CEO</span>}
            {!isCeo && agentRole && (
              <span className={styles.roleBadge}>{agentRole}</span>
            )}
            {isPinned && !isCeo && (
              <Pin size={11} className={styles.pinIcon} />
            )}
          </span>
          <span className={styles.time}>{formatChatTime(agent.updated_at)}</span>
        </span>
        <span className={styles.preview}>{preview}</span>
      </span>
    </button>
  );
}
