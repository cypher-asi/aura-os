import { useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Button, Menu } from "@cypher-asi/zui";
import {
  User,
  MessageSquare,
  Zap,
  FolderOpen,
  Check,
  Clock,
  Logs,
  ChartNoAxesColumnIncreasing,
  Ellipsis,
  Pencil,
  Trash2,
} from "lucide-react";
import { useAgentSidekick, type AgentSidekickTab } from "../stores/agent-sidekick-store";
import { useSelectedAgent } from "../stores";
import { useAuth } from "../../../stores/auth-store";
import { useClickOutside } from "../../../hooks/use-click-outside";
import styles from "../../../components/Sidekick/Sidekick.module.css";

const TAB_ICONS: { id: AgentSidekickTab; icon: React.ReactNode; title: string }[] = [
  { id: "profile", icon: <User size={16} />, title: "Profile" },
  { id: "chats", icon: <MessageSquare size={16} />, title: "Chats" },
  { id: "skills", icon: <Zap size={16} />, title: "Skills" },
  { id: "projects", icon: <FolderOpen size={16} />, title: "Projects" },
  { id: "tasks", icon: <Check size={16} />, title: "Tasks" },
  { id: "crons", icon: <Clock size={16} />, title: "Crons" },
  { id: "logs", icon: <Logs size={16} />, title: "Logs" },
  { id: "stats", icon: <ChartNoAxesColumnIncreasing size={16} />, title: "Stats" },
];

export function AgentSidekickTaskbar() {
  const { activeTab, setActiveTab, requestEdit, requestDelete } = useAgentSidekick();
  const { selectedAgent } = useSelectedAgent();
  const { user } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number } | null>(null);
  const moreBtnRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const isOwnAgent =
    !!user?.network_user_id &&
    !!selectedAgent &&
    user.network_user_id === selectedAgent.user_id;

  useLayoutEffect(() => {
    if (moreOpen && moreBtnRef.current) {
      const rect = moreBtnRef.current.getBoundingClientRect();
      setMenuRect({ top: rect.bottom + 4, left: rect.right - 180 });
    } else {
      setMenuRect(null);
    }
  }, [moreOpen]);

  useClickOutside([moreBtnRef, moreMenuRef], () => setMoreOpen(false), moreOpen);

  return (
    <div className={styles.sidekickTaskbar}>
      <div className={styles.sidekickTabBar}>
        {TAB_ICONS.map(({ id, icon, title }) => (
          <Button
            key={id}
            variant="ghost"
            size="sm"
            iconOnly
            icon={icon}
            title={title}
            aria-label={title}
            onClick={() => setActiveTab(id)}
            aria-pressed={activeTab === id}
            selected={activeTab === id}
          />
        ))}
      </div>
      {isOwnAgent && (
        <div ref={moreBtnRef} className={styles.moreButtonWrap}>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={<Ellipsis size={16} />}
            onClick={() => setMoreOpen((v) => !v)}
            title="More actions"
            aria-label="More actions"
          />
          {moreOpen &&
            menuRect &&
            createPortal(
              <div
                ref={moreMenuRef}
                className={styles.moreMenu}
                style={{
                  position: "fixed",
                  top: menuRect.top,
                  left: menuRect.left,
                  zIndex: 100,
                }}
              >
                <Menu
                  items={[
                    { id: "edit", label: "Edit", icon: <Pencil size={14} /> },
                    { id: "delete", label: "Delete", icon: <Trash2 size={14} /> },
                  ]}
                  onChange={(id) => {
                    setMoreOpen(false);
                    if (id === "edit") requestEdit();
                    if (id === "delete") requestDelete();
                  }}
                  background="solid"
                  border="solid"
                  rounded="md"
                  width={180}
                  isOpen
                />
              </div>,
              document.body,
            )}
        </div>
      )}
    </div>
  );
}
