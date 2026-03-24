import type { CSSProperties, ReactNode } from "react";
import { Lane } from "../Lane";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import styles from "./ResponsiveMainLane.module.css";

interface ResponsiveMainLaneProps {
  children: ReactNode;
  taskbar?: ReactNode;
  footer?: ReactNode;
  mobileTaskbar?: ReactNode | null;
  mobileFooter?: ReactNode | null;
  className?: string;
  style?: CSSProperties;
}

export function ResponsiveMainLane({
  children,
  taskbar,
  footer,
  mobileTaskbar = null,
  mobileFooter = null,
  className,
  style,
}: ResponsiveMainLaneProps) {
  const { isMobileLayout } = useAuraCapabilities();

  return (
    <Lane
      flex
      className={className}
      style={style}
      taskbar={isMobileLayout ? mobileTaskbar : taskbar}
      footer={isMobileLayout ? mobileFooter : footer}
    >
      <main className={styles.mainContent}>
        {children}
      </main>
    </Lane>
  );
}
