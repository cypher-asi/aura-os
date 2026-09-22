import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

export interface SidekickMenuState<T> {
  x: number;
  y: number;
  item: T;
}

export interface UseSidekickItemContextMenuOptions<T> {
  resolveItem: (nodeId: string) => T | null | undefined;
}

export interface UseSidekickItemContextMenuResult<T> {
  menu: SidekickMenuState<T> | null;
  menuRef: React.RefObject<HTMLDivElement | null>;
  handleContextMenu: (event: ReactMouseEvent) => void;
  openMenu: (item: T, x: number, y: number) => void;
  closeMenu: () => void;
}

export function useSidekickItemContextMenu<T>(
  options: UseSidekickItemContextMenuOptions<T>,
): UseSidekickItemContextMenuResult<T> {
  const { resolveItem } = options;
  const [menu, setMenu] = useState<SidekickMenuState<T> | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setMenu(null), []);

  const openMenu = useCallback((item: T, x: number, y: number) => {
    setMenu({ item, x, y });
  }, []);

  const handleContextMenu = useCallback((event: ReactMouseEvent) => {
    const target = (event.target as HTMLElement).closest("[data-list-item][id]");
    if (!target) return;
    const nodeId = target.id;
    const item = resolveItem(nodeId);
    if (!item) return;
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, item });
  }, [resolveItem]);

  useEffect(() => {
    if (!menu) return;
    const handleDocumentClick = (e: globalThis.MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menu]);

  return useMemo(
    () => ({ menu, menuRef, handleContextMenu, openMenu, closeMenu }),
    [menu, handleContextMenu, openMenu, closeMenu],
  );
}
