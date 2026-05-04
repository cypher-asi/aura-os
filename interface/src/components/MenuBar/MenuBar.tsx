import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { formatShortcut } from "../../lib/platform";
import { MENU_DEFINITIONS, type MenuDefinition, type MenuActionKey } from "./menu-config";
import { useMenuActions } from "./use-menu-actions";
import { useMenuShortcuts } from "./use-menu-shortcuts";
import styles from "./MenuBar.module.css";

interface MenuPanelProps {
  menu: MenuDefinition;
  position: { top: number; left: number };
  onSelect: (key: MenuActionKey) => void;
  onClose: () => void;
  panelRef: React.RefObject<HTMLDivElement | null>;
  isItemDisabled: (key: MenuActionKey) => boolean;
}

function MenuPanel({ menu, position, onSelect, onClose, panelRef, isItemDisabled }: MenuPanelProps) {
  const style: CSSProperties = { top: position.top, left: position.left };
  return (
    <div
      ref={panelRef}
      className={`${styles.panel} titlebar-no-drag`}
      role="menu"
      aria-label={menu.label}
      style={style}
      onContextMenu={(event) => event.preventDefault()}
    >
      {menu.entries.map((entry, index) => {
        if (entry.type === "divider") {
          return <hr key={`divider-${menu.id}-${index}`} className={styles.divider} />;
        }
        const disabled = isItemDisabled(entry.id);
        const shortcut = entry.shortcut ? formatShortcut(entry.shortcut) : null;
        return (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            className={styles.item}
            disabled={disabled}
            aria-disabled={disabled || undefined}
            onClick={() => {
              if (disabled) return;
              onSelect(entry.id);
              onClose();
            }}
          >
            <span className={styles.itemLabel}>{entry.label}</span>
            {shortcut ? <span className={styles.itemShortcut}>{shortcut}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function MenuBar() {
  const { actions, isItemDisabled } = useMenuActions();
  useMenuShortcuts({ actions, isItemDisabled });

  const [openMenuId, setOpenMenuId] = useState<MenuDefinition["id"] | null>(null);
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerRefs = useRef<Map<MenuDefinition["id"], HTMLButtonElement>>(new Map());
  const panelRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const menus = useMemo(() => MENU_DEFINITIONS, []);

  const computePosition = useCallback((menuId: MenuDefinition["id"]) => {
    const trigger = triggerRefs.current.get(menuId);
    if (!trigger) return { top: 0, left: 0 };
    const rect = trigger.getBoundingClientRect();
    return { top: rect.bottom, left: rect.left };
  }, []);

  const openMenu = useCallback(
    (menuId: MenuDefinition["id"]) => {
      setOpenMenuId(menuId);
      setPanelPosition(computePosition(menuId));
    },
    [computePosition],
  );

  const closeMenu = useCallback(() => {
    setOpenMenuId(null);
  }, []);

  const handleTriggerClick = useCallback(
    (menuId: MenuDefinition["id"]) => {
      if (openMenuId === menuId) {
        closeMenu();
      } else {
        openMenu(menuId);
      }
    },
    [closeMenu, openMenu, openMenuId],
  );

  const handleTriggerEnter = useCallback(
    (menuId: MenuDefinition["id"]) => {
      if (openMenuId !== null && openMenuId !== menuId) {
        openMenu(menuId);
      }
    },
    [openMenu, openMenuId],
  );

  useEffect(() => {
    if (!openMenuId) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current && panelRef.current.contains(target)) return;
      if (containerRef.current && containerRef.current.contains(target)) return;
      closeMenu();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
      }
    };
    const handleResize = () => closeMenu();
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleResize, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleResize, true);
    };
  }, [openMenuId, closeMenu]);

  const handleSelect = useCallback(
    (key: MenuActionKey) => {
      const action = actions[key];
      if (action) action();
    },
    [actions],
  );

  const activeMenu = openMenuId ? menus.find((m) => m.id === openMenuId) ?? null : null;

  return (
    <div ref={containerRef} className={`${styles.menuBar} titlebar-no-drag`} role="menubar" aria-label="Application menu">
      {menus.map((menu) => {
        const isOpen = openMenuId === menu.id;
        return (
          <button
            key={menu.id}
            ref={(node) => {
              if (node) triggerRefs.current.set(menu.id, node);
              else triggerRefs.current.delete(menu.id);
            }}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={isOpen}
            data-open={isOpen || undefined}
            className={`${styles.trigger} ${isOpen ? styles.triggerOpen : ""} titlebar-no-drag`}
            onClick={() => handleTriggerClick(menu.id)}
            onPointerEnter={() => handleTriggerEnter(menu.id)}
          >
            {menu.label}
          </button>
        );
      })}
      {activeMenu && typeof document !== "undefined"
        ? createPortal(
            <MenuPanel
              menu={activeMenu}
              position={panelPosition}
              onSelect={handleSelect}
              onClose={closeMenu}
              panelRef={panelRef}
              isItemDisabled={isItemDisabled}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
