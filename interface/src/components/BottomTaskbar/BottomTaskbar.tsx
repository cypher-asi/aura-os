import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Circle, CreditCard, StarOff, X } from "lucide-react";
import { Button, Menu } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import { useCreditBalance } from "../CreditsBadge/useCreditBalance";
import { formatCredits } from "../../utils/format";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { useAppStore } from "../../stores/app-store";
import { useAppUIStore } from "../../stores/app-ui-store";
import { useDesktopWindowStore } from "../../stores/desktop-window-store";
import { ConnectionDot } from "../ConnectionDot/ConnectionDot";
import { Avatar } from "../Avatar";
import { AppNavRail } from "../AppNavRail";
import { useFavoriteAgents, useAgentStore } from "../../apps/agents/stores";
import { useAvatarState } from "../../hooks/use-avatar-state";
import { useProfileStatusStore } from "../../stores/profile-status-store";
import type { Agent } from "../../types";
import styles from "./BottomTaskbar.module.css";

const unfavoriteMenuItems: MenuItem[] = [
  { id: "unfavorite", label: "Remove from taskbar", icon: <StarOff size={14} /> },
];

const closeWindowMenuItem: MenuItem = {
  id: "close-window",
  label: "Close window",
  icon: <X size={14} />,
};

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

interface FavCtxMenu {
  x: number;
  y: number;
  agentId: string;
}

function FavoriteAgentButton({
  agent,
  onClick,
  onContextMenu,
  hasOpenWindow,
}: {
  agent: Agent;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  hasOpenWindow: boolean;
}) {
  const { status, isLocal } = useAvatarState(agent.agent_id);
  return (
    <button
      type="button"
      className={`${styles.favoriteBtn}${hasOpenWindow ? ` ${styles.favoriteBtnOpen}` : ""}`}
      title={agent.name}
      onClick={onClick}
      onContextMenu={onContextMenu}
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
}

export function BottomTaskbar() {
  const openBuyCredits = useUIModalStore((s) => s.openBuyCredits);
  const activeApp = useAppStore((s) => s.activeApp);
  const { credits } = useCreditBalance();
  const time = useClock();
  const display = credits !== null ? formatCredits(credits) : "---";
  const navigate = useNavigate();
  const favoriteAgents = useFavoriteAgents();
  const toggleFavorite = useAgentStore((s) => s.toggleFavorite);
  const previousPath = useAppUIStore((s) => s.previousPath);
  const registerAgents = useProfileStatusStore((s) => s.registerAgents);
  const registerRemote = useProfileStatusStore((s) => s.registerRemoteAgents);
  const desktopWindows = useDesktopWindowStore((s) => s.windows);
  const openOrFocus = useDesktopWindowStore((s) => s.openOrFocus);
  const closeDesktopWindow = useDesktopWindowStore((s) => s.closeWindow);

  useEffect(() => {
    if (favoriteAgents.length === 0) return;
    registerAgents(favoriteAgents.map((a) => ({ id: a.agent_id, machineType: a.machine_type })));
    const remote = favoriteAgents.filter((a) => a.machine_type === "remote" && a.network_agent_id);
    if (remote.length > 0) registerRemote(remote);
  }, [favoriteAgents, registerAgents, registerRemote]);

  const [favCtx, setFavCtx] = useState<FavCtxMenu | null>(null);
  const favCtxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!favCtx) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (favCtxRef.current && !favCtxRef.current.contains(e.target as Node)) {
        setFavCtx(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFavCtx(null);
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [favCtx]);

  const handleFavContextMenu = useCallback(
    (e: React.MouseEvent, agentId: string) => {
      e.preventDefault();
      setFavCtx({ x: e.clientX, y: e.clientY, agentId });
    },
    [],
  );

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
    [favCtx, toggleFavorite, closeDesktopWindow],
  );

  const contextMenuItems = useMemo(() => {
    if (!favCtx) return unfavoriteMenuItems;
    const hasWindow = !!desktopWindows[favCtx.agentId];
    if (hasWindow) return [closeWindowMenuItem, ...unfavoriteMenuItems];
    return unfavoriteMenuItems;
  }, [favCtx, desktopWindows]);

  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          selected={activeApp.id === "desktop"}
          icon={<Circle size={18} />}
          title="Desktop"
          aria-label="Desktop"
          className={styles.desktopBtn}
          onClick={() => {
            if (activeApp.id === "desktop") {
              if (previousPath) navigate(previousPath);
            } else {
              navigate("/desktop");
            }
          }}
        />
        <AppNavRail layout="taskbar" />
      </div>

      <div className={styles.center}>
        {favoriteAgents.length > 0 && (
          <div className={styles.favorites}>
            {favoriteAgents.map((agent) => (
              <FavoriteAgentButton
                key={agent.agent_id}
                agent={agent}
                hasOpenWindow={!!desktopWindows[agent.agent_id]}
                onClick={() => {
                  const isOnDesktop = activeApp.id === "desktop";
                  const hasWindow = !!desktopWindows[agent.agent_id];
                  if (isOnDesktop && hasWindow) {
                    closeDesktopWindow(agent.agent_id);
                  } else {
                    if (!isOnDesktop) navigate("/desktop");
                    openOrFocus(agent.agent_id);
                  }
                }}
                onContextMenu={(e) => handleFavContextMenu(e, agent.agent_id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className={styles.right}>
        <button
          type="button"
          className={styles.creditsButton}
          onClick={openBuyCredits}
        >
          <span className={styles.creditsLabel}>{display}</span>
          <CreditCard size={14} />
        </button>
        <span className={styles.wifiIcon}><ConnectionDot /></span>
        <span className={styles.clock}>{time}</span>
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
    </div>
  );
}
