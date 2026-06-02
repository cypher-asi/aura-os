import { useEffect, useRef } from "react";
import { FilePlus, FolderPlus, Pencil, Trash2 } from "lucide-react";
import styles from "./IdeView.module.css";

export interface ContextMenuTarget {
  path: string;
  name: string;
  isDir: boolean;
  isRoot: boolean;
  x: number;
  y: number;
}

interface Props {
  target: ContextMenuTarget;
  onNewFile: () => void;
  onNewDirectory: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function ContextMenu({ target, onNewFile, onNewDirectory, onRename, onDelete, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw) el.style.left = `${target.x - rect.width}px`;
    if (rect.bottom > vh) el.style.top = `${target.y - rect.height}px`;
  }, [target.x, target.y]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div ref={menuRef} className={styles.contextMenu} style={{ left: target.x, top: target.y }}>
      {target.isDir && (
        <>
          <button className={styles.contextMenuItem} onClick={onNewFile}>
            <FilePlus size={14} /> New File
          </button>
          <button className={styles.contextMenuItem} onClick={onNewDirectory}>
            <FolderPlus size={14} /> New Folder
          </button>
        </>
      )}
      {!target.isRoot && (
        <>
          {target.isDir && <div className={styles.contextMenuDivider} />}
          <button className={styles.contextMenuItem} onClick={onRename}>
            <Pencil size={14} /> Rename
          </button>
          <button className={styles.contextMenuItemDanger} onClick={onDelete}>
            <Trash2 size={14} /> Delete
          </button>
        </>
      )}
    </div>
  );
}
