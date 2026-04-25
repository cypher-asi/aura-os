import { createPortal } from "react-dom";
import { Menu } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import { Bot, Pencil, Settings, Trash2 } from "lucide-react";
import type { useProjectListActions } from "../../hooks/use-project-list-actions";
import styles from "./ProjectList.module.css";

const projectMenuItems: MenuItem[] = [
  { id: "add-agent", label: "Add Agent", icon: <Bot size={14} /> },
  { id: "rename", label: "Rename", icon: <Pencil size={14} /> },
  { id: "settings", label: "Settings", icon: <Settings size={14} /> },
  { type: "separator" },
  { id: "delete", label: "Delete", icon: <Trash2 size={14} /> },
];

const agentMenuItems: MenuItem[] = [
  { id: "rename-agent", label: "Rename", icon: <Pencil size={14} /> },
  { type: "separator" },
  { id: "delete-agent", label: "Delete", icon: <Trash2 size={14} /> },
];

interface Props {
  actions: ReturnType<typeof useProjectListActions>;
}

export function ExplorerContextMenu({ actions }: Props) {
  if (!actions.ctxMenu) return null;
  return createPortal(
    <div ref={actions.ctxMenuRef} className={styles.contextMenuOverlay} style={{ left: actions.ctxMenu.x, top: actions.ctxMenu.y }}>
      <Menu
        items={actions.ctxMenu.project ? projectMenuItems : agentMenuItems}
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
