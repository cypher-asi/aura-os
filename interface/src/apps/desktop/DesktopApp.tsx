import { Circle } from "lucide-react";
import type { ReactNode } from "react";
import type { AuraApp } from "../types";
import { useSelectionMarquee } from "./useSelectionMarquee";
import styles from "./DesktopApp.module.css";

function EmptyPanel() {
  return null;
}

function MainPanel({ children }: { children?: ReactNode }) {
  const { rect, handlers } = useSelectionMarquee();

  return (
    <div className={styles.surface} {...handlers}>
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
    </div>
  );
}

export const DesktopApp: AuraApp = {
  id: "desktop",
  label: "Desktop",
  icon: Circle,
  basePath: "/desktop",
  LeftPanel: EmptyPanel,
  MainPanel,
};
