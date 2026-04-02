import { useMemo } from "react";
import { Circle } from "lucide-react";
import type { ReactNode } from "react";
import type { AuraApp } from "../types";
import { useSelectionMarquee } from "./useSelectionMarquee";
import { useDesktopWindowStore } from "../../stores/desktop-window-store";
import { AgentWindow } from "../../components/AgentWindow";
import styles from "./DesktopApp.module.css";

function EmptyPanel() {
  return null;
}

function WindowLayer() {
  const windows = useDesktopWindowStore((s) => s.windows);

  const sorted = useMemo(() => {
    return Object.values(windows).sort((a, b) => a.zIndex - b.zIndex);
  }, [windows]);

  const topZ = sorted.length > 0 ? sorted[sorted.length - 1].zIndex : 0;

  return (
    <>
      {sorted.map((win) => (
        <AgentWindow key={win.agentId} win={win} isFocused={win.zIndex === topZ} />
      ))}
    </>
  );
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
      <WindowLayer />
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
