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
  closeMenu: () => void;
}

export function useSidekickItemContextMenu<T>(
  options: UseSidekickItemContextMenuOptions<T>,
): UseSidekickItemContextMenuResult<T> {
  const { resolveItem } = options;
  const [menu, setMenu] = useState<SidekickMenuState<T> | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const resolveRef = useRef(resolveItem);
  resolveRef.current = resolveItem;

  const closeMenu = useCallback(() => setMenu(null), []);

  const handleContextMenu = useCallback((event: ReactMouseEvent) => {
    const target = (event.target as HTMLElement).closest("button[id]");
    if (!target) return;
    const nodeId = target.id;
    const item = resolveRef.current(nodeId);
    if (!item) return;
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, item });
  }, []);

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
    () => ({ menu, menuRef, handleContextMenu, closeMenu }),
    [menu, handleContextMenu, closeMenu],
  );
}
