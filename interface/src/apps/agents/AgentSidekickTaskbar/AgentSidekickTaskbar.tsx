import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Button, Menu, type MenuItem } from "@cypher-asi/zui";
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
import { useOverflowTabs } from "../../../hooks/use-overflow-tabs";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const isOwnAgent =
    !!user?.network_user_id &&
    !!selectedAgent &&
    user.network_user_id === selectedAgent.user_id;

  const { visibleItems, overflowItems } = useOverflowTabs(
    containerRef,
    TAB_ICONS,
    isOwnAgent,
  );

  const showMoreButton = overflowItems.length > 0 || isOwnAgent;

  const [animated, setAnimated] = useState(false);
  const [exitingTabs, setExitingTabs] = useState<typeof TAB_ICONS>([]);
  const prevVisibleIdsRef = useRef<string[] | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const currentIds = visibleItems.map((t) => t.id);
    const prevIds = prevVisibleIdsRef.current;
    prevVisibleIdsRef.current = currentIds;
    if (!animated || !prevIds) return;

    const removed = TAB_ICONS.filter(
      (t) => prevIds.includes(t.id) && !currentIds.includes(t.id),
    );
    if (removed.length > 0) {
      clearTimeout(exitTimerRef.current);
      setExitingTabs(removed);
      exitTimerRef.current = setTimeout(() => setExitingTabs([]), 120);
    }
  }, [visibleItems, animated]);

  const menuItems = useMemo<MenuItem[]>(() => {
    const overflow: MenuItem[] = overflowItems.map(({ id, icon, title }) => ({
      id,
      label: title,
      icon,
    }));
    const actions: MenuItem[] = isOwnAgent
      ? [
          { id: "edit", label: "Edit", icon: <Pencil size={14} /> },
          { id: "delete", label: "Delete", icon: <Trash2 size={14} /> },
        ]
      : [];
    const sep: MenuItem[] =
      overflow.length > 0 && actions.length > 0 ? [{ type: "separator" }] : [];
    return [...overflow, ...sep, ...actions];
  }, [overflowItems, isOwnAgent]);

  useLayoutEffect(() => {
    if (moreOpen && moreBtnRef.current) {
      const rect = moreBtnRef.current.getBoundingClientRect();
      setMenuRect({ top: rect.bottom + 4, left: rect.right - 180 });
    } else {
      setMenuRect(null);
    }
  }, [moreOpen]);

  useClickOutside([moreBtnRef, moreMenuRef], () => setMoreOpen(false), moreOpen);

  const activeInOverflow = overflowItems.some((t) => t.id === activeTab);

  return (
    <div ref={containerRef} className={styles.sidekickTaskbar}>
      <div className={styles.sidekickTabBar} data-animated={animated || undefined}>
        {visibleItems.map(({ id, icon, title }) => (
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
        {exitingTabs.map(({ id, icon }) => (
          <span key={`exit-${id}`} className={styles.tabExit}>
            <Button variant="ghost" size="sm" iconOnly icon={icon} aria-hidden />
          </span>
        ))}
      </div>
      {showMoreButton && (
        <div ref={moreBtnRef} className={styles.moreButtonWrap}>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={<Ellipsis size={16} />}
            onClick={() => setMoreOpen((v) => !v)}
            title="More"
            aria-label="More"
            selected={activeInOverflow}
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
                  items={menuItems}
                  value={activeInOverflow ? activeTab : undefined}
                  onChange={(id) => {
                    setMoreOpen(false);
                    if (id === "edit") requestEdit();
                    else if (id === "delete") requestDelete();
                    else setActiveTab(id as AgentSidekickTab);
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
