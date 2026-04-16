import { createPortal } from "react-dom";
import { Menu } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import { Trash2 } from "lucide-react";
import styles from "./SidekickItemContextMenu.module.css";

const deleteMenuItems: MenuItem[] = [
  { id: "delete", label: "Delete", icon: <Trash2 size={14} /> },
];

interface Props {
  x: number;
  y: number;
  menuRef: React.RefObject<HTMLDivElement | null>;
  onAction: (actionId: string) => void;
}

export function SidekickItemContextMenu({ x, y, menuRef, onAction }: Props) {
  return createPortal(
    <div ref={menuRef} className={styles.overlay} style={{ left: x, top: y }}>
      <Menu
        items={deleteMenuItems}
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
