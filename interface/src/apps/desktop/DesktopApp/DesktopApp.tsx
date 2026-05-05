import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Circle, Image } from "lucide-react";
import { Menu } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import type { ReactNode } from "react";
import type { AuraAppModule } from "../../types";
import { useSelectionMarquee } from "./useSelectionMarquee";
import { BackgroundModal } from "../BackgroundModal";
import styles from "./DesktopApp.module.css";

function EmptyPanel() {
  return null;
}

const contextMenuItems: MenuItem[] = [
  { id: "set-background", label: "Set Background\u2026", icon: <Image size={14} /> },
];

function MainPanel({ children }: { children?: ReactNode }) {
  const { rect, handlers } = useSelectionMarquee();
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [bgModalOpen, setBgModalOpen] = useState(false);
  const ctxRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      setCtxMenu({ x: e.clientX, y: e.clientY });
    },
    [],
  );

  useEffect(() => {
    if (!ctxMenu) return;
    const dismiss = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && ctxRef.current?.contains(e.target as Node)) return;
      setCtxMenu(null);
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [ctxMenu]);

  const handleMenuAction = useCallback((id: string) => {
    setCtxMenu(null);
    if (id === "set-background") {
      setBgModalOpen(true);
    }
  }, []);

  return (
    <div className={styles.surface} {...handlers} onContextMenu={handleContextMenu}>
      {rect && (
        <div
          className={styles.marquee}
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }}
        />
      )}
      {children}

      {ctxMenu &&
        createPortal(
          <div
            ref={ctxRef}
            className={styles.contextMenuOverlay}
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <Menu items={contextMenuItems} onChange={handleMenuAction} />
          </div>,
          document.body,
        )}

      <BackgroundModal isOpen={bgModalOpen} onClose={() => setBgModalOpen(false)} />
    </div>
  );
}

export const DesktopApp: AuraAppModule = {
  id: "desktop",
  label: "Desktop",
  icon: Circle,
  basePath: "/desktop",
  LeftPanel: EmptyPanel,
  MainPanel,
};
