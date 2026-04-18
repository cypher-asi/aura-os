import { createPortal } from "react-dom";
import { Menu } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import {
  FilePlus,
  FolderPlus,
  FolderOpen,
  Pencil,
  Trash2,
} from "lucide-react";
import type { NotesContextMenuApi } from "../NotesNav/useNotesContextMenu";
import styles from "./NotesEntryContextMenu.module.css";

const noteMenuItems: MenuItem[] = [
  { id: "rename", label: "Rename", icon: <Pencil size={14} /> },
  { id: "reveal", label: "Reveal in folder", icon: <FolderOpen size={14} /> },
  { type: "separator" },
  { id: "delete", label: "Delete", icon: <Trash2 size={14} /> },
];

const folderMenuItems: MenuItem[] = [
  { id: "new-note", label: "New note", icon: <FilePlus size={14} /> },
  { id: "new-folder", label: "New folder", icon: <FolderPlus size={14} /> },
  { id: "rename", label: "Rename", icon: <Pencil size={14} /> },
  { type: "separator" },
  { id: "delete", label: "Delete", icon: <Trash2 size={14} /> },
];

export interface NotesEntryContextMenuProps {
  actions: NotesContextMenuApi;
}

export function NotesEntryContextMenu({ actions }: NotesEntryContextMenuProps) {
  const menu = actions.ctxMenu;
  if (!menu) return null;
  const items = menu.target.kind === "note" ? noteMenuItems : folderMenuItems;
  return createPortal(
    <div
      ref={actions.ctxMenuRef}
      className={styles.overlay}
      style={{ left: menu.x, top: menu.y }}
    >
      <Menu
        items={items}
        onChange={actions.handleMenuAction}
        background="solid"
        border="solid"
        rounded="md"
        width={180}
        isOpen
      />
    </div>,
    document.body,
  );
}
