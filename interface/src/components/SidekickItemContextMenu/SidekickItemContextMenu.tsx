import { createPortal } from "react-dom";
import { Menu } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import { Pencil, Trash2 } from "lucide-react";
import styles from "./SidekickItemContextMenu.module.css";

export type SidekickMenuAction = "rename" | "delete";

const RENAME_ITEM: MenuItem = { id: "rename", label: "Rename", icon: <Pencil size={14} /> };
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
