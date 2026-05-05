import { Circle } from "lucide-react";
import type { ReactNode } from "react";
import type { AuraAppModule } from "../../types";
import { useSelectionMarquee } from "./useSelectionMarquee";
import { useDesktopContextMenu } from "../../../components/DesktopContextMenu";
import styles from "./DesktopApp.module.css";

function EmptyPanel() {
  return null;
}

function MainPanel({ children }: { children?: ReactNode }) {
  const { rect, handlers } = useSelectionMarquee();
  const { handleContextMenu, menuElement } = useDesktopContextMenu();

  const onContextMenu = (event: React.MouseEvent) => {
    if (event.target !== event.currentTarget) return;
    handleContextMenu(event);
  };

  return (
    <div className={styles.surface} {...handlers} onContextMenu={onContextMenu}>
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
      {menuElement}
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
