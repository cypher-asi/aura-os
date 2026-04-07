import { useEffect, type RefObject } from "react";
import type { Node } from "@xyflow/react";

export function useCanvasMenuDismissEffect(
  ctxMenu: { x: number; y: number } | null,
  nodeCtxMenu: { x: number; y: number; nodeId: string } | null,
  edgeCtxMenu: { x: number; y: number; edgeId: string } | null,
  selectionCtxMenu: { x: number; y: number; nodeIds: string[] } | null,
  ctxMenuRef: RefObject<HTMLDivElement | null>,
  nodeCtxMenuRef: RefObject<HTMLDivElement | null>,
  edgeCtxMenuRef: RefObject<HTMLDivElement | null>,
  selectionCtxMenuRef: RefObject<HTMLDivElement | null>,
  dismissMenus: () => void,
) {
  useEffect(() => {
    const activeMenu = ctxMenu
      ? ctxMenuRef
      : nodeCtxMenu
        ? nodeCtxMenuRef
        : edgeCtxMenu
          ? edgeCtxMenuRef
          : selectionCtxMenu
            ? selectionCtxMenuRef
            : null;
    if (!activeMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (activeMenu.current && !activeMenu.current.contains(e.target as HTMLElement)) dismissMenus();
    };
    const handleEscape = (e: KeyboardEvent) => { if (e.key === "Escape") dismissMenus(); };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [ctxMenu, nodeCtxMenu, edgeCtxMenu, selectionCtxMenu, dismissMenus, ctxMenuRef, nodeCtxMenuRef, edgeCtxMenuRef, selectionCtxMenuRef]);
}

export function useCanvasKeyboardShortcutsEffect(
  wrapperRef: RefObject<HTMLDivElement | null>,
  nodes: Node[],
  requestDeleteNodes: (ids: string[]) => void,
  copySelection: () => void,
  pasteNodes: () => void,
  deleteNodes: (ids: string[]) => void,
  undo: () => void,
  redo: () => void,
) {
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const getPane = () => el.querySelector<HTMLElement>(".react-flow__pane");

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") getPane()?.classList.add("dragging");

      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "Delete" || e.key === "Backspace") {
        const selected = nodes.filter((n) => n.selected).map((n) => n.id);
        if (selected.length > 0) requestDeleteNodes(selected);
        return;
      }

      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === "c" && !e.shiftKey) {
        copySelection();
      } else if (mod && key === "x" && !e.shiftKey) {
        e.preventDefault();
        copySelection();
        const sel = nodes.filter((n) => n.selected).map((n) => n.id);
        if (sel.length > 0) deleteNodes(sel);
      } else if (mod && key === "v" && !e.shiftKey) {
        e.preventDefault();
        pasteNodes();
      } else if (mod && key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && ((e.shiftKey && key === "z") || (!e.shiftKey && key === "y"))) {
        e.preventDefault();
        redo();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") getPane()?.classList.remove("dragging");
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 1) getPane()?.classList.add("dragging");
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 1) getPane()?.classList.remove("dragging");
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("mouseup", onMouseUp);
    };
  }, [nodes, requestDeleteNodes, copySelection, pasteNodes, deleteNodes, undo, redo, wrapperRef]);
}
