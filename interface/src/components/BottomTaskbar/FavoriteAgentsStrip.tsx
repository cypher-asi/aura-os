import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { StarOff, X } from "lucide-react";
import { Menu } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import { Avatar } from "../Avatar";
import { useFavoriteAgents, useAgentStore } from "../../apps/agents/stores";
import { useAvatarState } from "../../hooks/use-avatar-state";
import { useProfileStatusStore } from "../../stores/profile-status-store";
import { selectIsWindowOpen, useDesktopWindowStore } from "../../stores/desktop-window-store";
import type { Agent } from "../../shared/types";
import styles from "./BottomTaskbar.module.css";

const unfavoriteMenuItems: MenuItem[] = [
  { id: "unfavorite", label: "Remove from taskbar", icon: <StarOff size={14} /> },
];

const closeWindowMenuItem: MenuItem = {
  id: "close-window",
  label: "Close window",
  icon: <X size={14} />,
};

interface FavCtxMenu {
  x: number;
  y: number;
  agentId: string;
}

const FavoriteAgentTaskbarItem = memo(function FavoriteAgentTaskbarItem({
  agent,
  onContextMenu,
}: {
  agent: Agent;
  onContextMenu: (event: React.MouseEvent, agentId: string) => void;
}) {
  const hasOpenWindow = useDesktopWindowStore(selectIsWindowOpen(agent.agent_id));
  const openOrFocus = useDesktopWindowStore((s) => s.openOrFocus);
  const closeDesktopWindow = useDesktopWindowStore((s) => s.closeWindow);
  const { status, isLocal } = useAvatarState(agent.agent_id);

  const handleClick = useCallback(() => {
    if (hasOpenWindow) {
      closeDesktopWindow(agent.agent_id);
    } else {
      openOrFocus(agent.agent_id);
    }
  }, [agent.agent_id, closeDesktopWindow, hasOpenWindow, openOrFocus]);

  return (
    <button
      type="button"
      className={`${styles.favoriteBtn}${hasOpenWindow ? ` ${styles.favoriteBtnOpen}` : ""}`}
      title={agent.name}
      onClick={handleClick}
      onContextMenu={(event) => onContextMenu(event, agent.agent_id)}
    >
      <Avatar
        avatarUrl={agent.icon ?? undefined}
        name={agent.name}
        type="agent"
        size={20}
        status={status}
        isLocal={isLocal}
      />
      {hasOpenWindow && <span className={styles.openIndicator} />}
    </button>
  );
});

export function FavoriteAgentsStrip() {
  const favoriteAgents = useFavoriteAgents();
  const toggleFavorite = useAgentStore((s) => s.toggleFavorite);
  const registerAgents = useProfileStatusStore((s) => s.registerAgents);
  const registerRemote = useProfileStatusStore((s) => s.registerRemoteAgents);
  const closeDesktopWindow = useDesktopWindowStore((s) => s.closeWindow);
  const [favCtx, setFavCtx] = useState<FavCtxMenu | null>(null);
  const favCtxRef = useRef<HTMLDivElement>(null);
  const activeContextAgentId = favCtx?.agentId ?? "";
  const contextAgentHasWindow = useDesktopWindowStore(selectIsWindowOpen(activeContextAgentId));

  useEffect(() => {
    if (favoriteAgents.length === 0) return;
    registerAgents(favoriteAgents.map((agent) => ({ id: agent.agent_id, machineType: agent.machine_type })));
    const remote = favoriteAgents.filter(
      (agent) => agent.machine_type === "remote" && agent.network_agent_id,
    );
    if (remote.length > 0) registerRemote(remote);
  }, [favoriteAgents, registerAgents, registerRemote]);

  useEffect(() => {
    if (!favCtx) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (favCtxRef.current && !favCtxRef.current.contains(event.target as Node)) {
        setFavCtx(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFavCtx(null);
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [favCtx]);

  const handleFavContextMenu = useCallback((event: React.MouseEvent, agentId: string) => {
    event.preventDefault();
    setFavCtx({ x: event.clientX, y: event.clientY, agentId });
  }, []);

  const handleFavMenuAction = useCallback(
    (actionId: string) => {
      if (!favCtx) return;
      if (actionId === "unfavorite") {
        toggleFavorite(favCtx.agentId);
      } else if (actionId === "close-window") {
        closeDesktopWindow(favCtx.agentId);
      }
      setFavCtx(null);
    },
    [closeDesktopWindow, favCtx, toggleFavorite],
  );

  const contextMenuItems = useMemo(() => {
    if (!favCtx) return unfavoriteMenuItems;
    return contextAgentHasWindow
      ? [closeWindowMenuItem, ...unfavoriteMenuItems]
      : unfavoriteMenuItems;
  }, [contextAgentHasWindow, favCtx]);

  if (favoriteAgents.length === 0) return null;

  return (
    <>
      <div className={styles.favorites}>
        {favoriteAgents.map((agent) => (
          <FavoriteAgentTaskbarItem
            key={agent.agent_id}
            agent={agent}
            onContextMenu={handleFavContextMenu}
          />
        ))}
      </div>

      {favCtx &&
        createPortal(
          <div
            ref={favCtxRef}
            className={styles.contextMenuOverlay}
            style={{ left: favCtx.x, top: favCtx.y }}
          >
            <Menu
              items={contextMenuItems}
              onChange={handleFavMenuAction}
              background="solid"
              border="solid"
              rounded="md"
              width={200}
              isOpen
            />
          </div>,
          document.body,
        )}
    </>
  );
}
