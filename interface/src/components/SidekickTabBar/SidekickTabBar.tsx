import { useState, useRef, useEffect, useLayoutEffect, useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Menu, type MenuItem } from "@cypher-asi/zui";
import { Ellipsis } from "lucide-react";
import { useClickOutside } from "../../hooks/use-click-outside";
import { useOverflowTabs } from "../../hooks/use-overflow-tabs";
import styles from "../Sidekick/Sidekick.module.css";

export interface TabItem {
  id: string;
  icon: ReactNode;
  title: string;
}

interface SidekickTabBarProps {
  tabs: readonly TabItem[];
  activeTab: string;
  onTabChange: (id: string) => void;
  /** Extra items appended to the overflow menu (e.g. Edit, Delete). */
  actions?: MenuItem[];
  /** Called when an action item is selected (receives the action id). */
  onAction?: (id: string) => void;
  /** Always reserve space for the more button even when all tabs fit. */
  alwaysShowMore?: boolean;
}

export function SidekickTabBar({
  tabs,
  activeTab,
  onTabChange,
  actions,
  onAction,
  alwaysShowMore = false,
}: SidekickTabBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const hasActions = !!actions && actions.length > 0;
  const reserveMore = alwaysShowMore || hasActions;

  const { visibleItems, overflowItems } = useOverflowTabs(
    containerRef,
    tabs,
    reserveMore,
  );

  const showMoreButton = overflowItems.length > 0 || hasActions;

  const [enteringIds, setEnteringIds] = useState<Set<string>>(new Set());
  const [exitingTabs, setExitingTabs] = useState<readonly TabItem[]>([]);
  const prevVisibleIdsRef = useRef<string[] | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const currentIds = visibleItems.map((t) => t.id);
    const prevIds = prevVisibleIdsRef.current;
    prevVisibleIdsRef.current = currentIds;
    if (!prevIds) return;

    const added = currentIds.filter((id) => !prevIds.includes(id));
    if (added.length > 0) setEnteringIds(new Set(added));

    const removed = tabs.filter(
      (t) => prevIds.includes(t.id) && !currentIds.includes(t.id),
    );
    if (removed.length > 0) {
      clearTimeout(exitTimerRef.current);
      setExitingTabs(removed);
      exitTimerRef.current = setTimeout(() => setExitingTabs([]), 150);
    }
  }, [visibleItems, tabs]);

  useEffect(() => {
    if (enteringIds.size === 0) return;
    let id1: number;
    let id2: number;
    id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => setEnteringIds(new Set()));
    });
    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
    };
  }, [enteringIds]);

  const actionIds = useMemo(() => new Set(actions?.map((a) => "id" in a ? a.id : undefined).filter(Boolean)), [actions]);

  const menuItems = useMemo<MenuItem[]>(() => {
    const overflow: MenuItem[] = overflowItems.map(({ id, icon, title }) => ({
      id,
      label: title,
      icon,
    }));
    const sep: MenuItem[] =
      overflow.length > 0 && hasActions ? [{ type: "separator" }] : [];
    return [...overflow, ...sep, ...(actions ?? [])];
  }, [overflowItems, actions, hasActions]);

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
      <div className={styles.sidekickTabBar}>
        {visibleItems.map(({ id, icon, title }) => (
          <Button
            key={id}
            variant="ghost"
            size="sm"
            iconOnly
            icon={icon}
            title={title}
            aria-label={title}
            onClick={() => onTabChange(id)}
            aria-pressed={activeTab === id}
            selected={activeTab === id}
            style={enteringIds.has(id) ? { opacity: 0 } : undefined}
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
                    if (actionIds.has(id)) onAction?.(id);
                    else onTabChange(id);
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
