import { createPortal } from "react-dom";
import { Menu } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import { Archive, ArchiveRestore, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import styles from "./SidekickItemContextMenu.module.css";

export type SidekickMenuAction =
  | "rename"
  | "archive"
  | "restore"
  | "pin"
  | "unpin"
  | "delete";

const RENAME_ITEM: MenuItem = { id: "rename", label: "Rename", icon: <Pencil size={14} /> };
const ARCHIVE_ITEM: MenuItem = { id: "archive", label: "Archive", icon: <Archive size={14} /> };
const RESTORE_ITEM: MenuItem = { id: "restore", label: "Restore", icon: <ArchiveRestore size={14} /> };
const PIN_ITEM: MenuItem = { id: "pin", label: "Pin to top", icon: <Pin size={14} /> };
const UNPIN_ITEM: MenuItem = { id: "unpin", label: "Unpin", icon: <PinOff size={14} /> };
const DELETE_ITEM: MenuItem = { id: "delete", label: "Delete", icon: <Trash2 size={14} /> };

interface Props {
  x: number;
  y: number;
  menuRef: React.RefObject<HTMLDivElement | null>;
  onAction: (actionId: string) => void;
  /**
   * Which actions to render. Defaults to `["rename", "delete"]`.
   * Callers (e.g. SessionList) can pass `["delete"]` to hide Rename.
   */
  actions?: SidekickMenuAction[];
}

export function SidekickItemContextMenu({ x, y, menuRef, onAction, actions = ["rename", "delete"] }: Props) {
  const items: MenuItem[] = actions.map((action) => {
    switch (action) {
      case "rename":
        return RENAME_ITEM;
      case "archive":
        return ARCHIVE_ITEM;
      case "restore":
        return RESTORE_ITEM;
      case "pin":
        return PIN_ITEM;
      case "unpin":
        return UNPIN_ITEM;
      case "delete":
        return DELETE_ITEM;
    }
  });

  return createPortal(
    <div ref={menuRef} className={styles.overlay} style={{ left: x, top: y }}>
      <Menu
        items={items}
        onChange={onAction}
        background="solid"
        border="solid"
        rounded="md"
        width={160}
        isOpen
      />
    </div>,
    document.body,
  );
}
