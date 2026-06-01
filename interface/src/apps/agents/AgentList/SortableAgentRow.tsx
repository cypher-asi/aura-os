import { type CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AgentConversationRow } from "../AgentConversationRow";
import { useChatHistoryStore, agentHistoryKey } from "../../../stores/chat-history-store";
import type { Agent } from "../../../shared/types";
import styles from "./AgentList.module.css";

export function AgentConversationRowWithHistory({
  agent,
  isMobileLibrary,
  isSelected,
  onClick,
  onContextMenu,
  onMouseEnter,
}: {
  agent: Agent;
  isMobileLibrary: boolean;
  isSelected: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onMouseEnter: () => void;
}) {
  const lastMessage = useChatHistoryStore((state) => {
    if (isMobileLibrary) return undefined;
    return state.previewLastMessages[agentHistoryKey(agent.agent_id)];
  });

  return (
    <AgentConversationRow
      agent={agent}
      lastMessage={lastMessage}
      showMetadataOnly={isMobileLibrary}
      isSelected={isSelected}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
    />
  );
}

export function SortableAgentConversationRow({
  agent,
  isMobileLibrary,
  isSelected,
  onClick,
  onContextMenu,
  onMouseEnter,
}: {
  agent: Agent;
  isMobileLibrary: boolean;
  isSelected: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onMouseEnter: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: agent.agent_id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={styles.sortableRow}
      {...attributes}
      {...listeners}
    >
      <AgentConversationRowWithHistory
        agent={agent}
        isMobileLibrary={isMobileLibrary}
        isSelected={isSelected}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onMouseEnter={onMouseEnter}
      />
    </div>
  );
}
