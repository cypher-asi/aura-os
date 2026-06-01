import { useState, useCallback, useEffect, useRef } from "react";
import { useAgentStore } from "../stores";
import { useCascadeDeleteAgent } from "../hooks/use-cascade-delete-agent";
import { useDeferredModalOpen } from "../../../shared/hooks/use-deferred-modal-open";
import type { Agent } from "../../../shared/types";

interface CtxMenuState {
  x: number;
  y: number;
  agent: Agent;
}

export function useAgentContextMenu(agentMap: Map<string, Agent>) {
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const [editTarget, setEditTarget] = useState<Agent | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
  const cascade = useCascadeDeleteAgent(deleteTarget);
  const { isOpen: deleteModalOpen } = useDeferredModalOpen({
    requestedOpen: !!deleteTarget,
    prepare: () => cascade.refresh(),
  });

  const togglePin = useAgentStore((s) => s.togglePin);
  const toggleFavorite = useAgentStore((s) => s.toggleFavorite);
  const pinnedIds = useAgentStore((s) => s.pinnedAgentIds);
  const favoriteIds = useAgentStore((s) => s.favoriteAgentIds);

  useEffect(() => {
    if (!ctxMenu) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [ctxMenu]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const target = (e.target as HTMLElement).closest("button[id]");
      if (!target) return;
      const agent = agentMap.get(target.id);
      if (agent) {
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY, agent });
      }
    },
    [agentMap],
  );

  const handleMenuAction = useCallback(
    (actionId: string) => {
      if (!ctxMenu) return;
      switch (actionId) {
        case "edit":
          setEditTarget(ctxMenu.agent);
          break;
        case "pin":
        case "unpin":
          togglePin(ctxMenu.agent.agent_id);
          break;
        case "favorite":
        case "unfavorite":
          toggleFavorite(ctxMenu.agent.agent_id);
          break;
        case "delete":
          setDeleteTarget(ctxMenu.agent);
          cascade.reset();
          break;
      }
      setCtxMenu(null);
    },
    [cascade, ctxMenu, togglePin, toggleFavorite],
  );

  return {
    ctxMenu,
    ctxMenuRef,
    editTarget,
    setEditTarget,
    deleteTarget,
    setDeleteTarget,
    deleteModalOpen,
    cascade,
    pinnedIds,
    favoriteIds,
    handleContextMenu,
    handleMenuAction,
  };
}
