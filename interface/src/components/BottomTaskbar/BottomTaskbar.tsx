import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Circle, CreditCard, StarOff } from "lucide-react";
import { Button, Menu } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import { useCreditBalance } from "../CreditsBadge/useCreditBalance";
import { formatCredits } from "../../utils/format";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { useAppStore } from "../../stores/app-store";
import { ConnectionDot } from "../ConnectionDot/ConnectionDot";
import { Avatar } from "../Avatar";
import { useFavoriteAgents, useAgentStore } from "../../apps/agents/stores";
import { useAvatarState } from "../../hooks/use-avatar-state";
import { useProfileStatusStore } from "../../stores/profile-status-store";
import type { Agent } from "../../types";
import styles from "./BottomTaskbar.module.css";

const unfavoriteMenuItems: MenuItem[] = [
  { id: "unfavorite", label: "Remove from taskbar", icon: <StarOff size={14} /> },
];

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
}: {
  agent: Agent;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { status, isLocal } = useAvatarState(agent.agent_id);
  return (
    <button
      type="button"
      className={styles.favoriteBtn}
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
  const registerAgents = useProfileStatusStore((s) => s.registerAgents);
  const registerRemote = useProfileStatusStore((s) => s.registerRemoteAgents);

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
      if (actionId === "unfavorite" && favCtx) {
        toggleFavorite(favCtx.agentId);
      }
      setFavCtx(null);
    },
    [favCtx, toggleFavorite],
  );

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
          onClick={() => navigate("/desktop")}
        />
      </div>

      <div className={styles.center}>
        {favoriteAgents.length > 0 && (
          <div className={styles.favorites}>
            {favoriteAgents.map((agent) => (
              <FavoriteAgentButton
                key={agent.agent_id}
                agent={agent}
                onClick={() => navigate(`/agents/${agent.agent_id}`)}
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
              items={unfavoriteMenuItems}
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
