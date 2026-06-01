import type { MenuItem } from "@cypher-asi/zui";
import { Pencil, Pin, PinOff, Star, StarOff, Trash2 } from "lucide-react";
import type { Agent } from "../../../shared/types";
import { isSuperAgent as isSuperAgentByPerms } from "../../../shared/types/permissions";

export function buildAgentMenuItems(
  agent: Agent,
  pinnedIds: Set<string>,
  favoriteIds: Set<string>,
  isOwnAgent: boolean,
): MenuItem[] {
  const isSuperAgent = isSuperAgentByPerms(agent);
  const isPinned = agent.is_pinned || pinnedIds.has(agent.agent_id);
  const isFavorite = favoriteIds.has(agent.agent_id);
  const items: MenuItem[] = [];

  if (isOwnAgent) {
    items.push({ id: "edit", label: "Edit", icon: <Pencil size={14} /> });
  }

  if (!isSuperAgent) {
    items.push(
      isPinned
        ? { id: "unpin", label: "Unpin", icon: <PinOff size={14} /> }
        : { id: "pin", label: "Pin to top", icon: <Pin size={14} /> },
    );
  }

  items.push(
    isFavorite
      ? { id: "unfavorite", label: "Remove from taskbar", icon: <StarOff size={14} /> }
      : { id: "favorite", label: "Add to taskbar", icon: <Star size={14} /> },
  );

  if (!isSuperAgent) {
    items.push({ id: "delete", label: "Delete", icon: <Trash2 size={14} /> });
  }

  return items;
}

export function pickReplacementAgentId(agents: Agent[], deletedAgentId: string): string | null {
  const index = agents.findIndex((agent) => agent.agent_id === deletedAgentId);
  if (index === -1) {
    return agents[0]?.agent_id ?? null;
  }
  return agents[index + 1]?.agent_id ?? agents[index - 1]?.agent_id ?? null;
}
