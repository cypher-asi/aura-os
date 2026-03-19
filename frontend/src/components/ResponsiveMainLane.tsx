import type { CSSProperties, ReactNode } from "react";
import { Lane } from "./Lane";
import { useAuraCapabilities } from "../hooks/use-aura-capabilities";
import styles from "./ResponsiveMainLane.module.css";

interface ResponsiveMainLaneProps {
  children: ReactNode;
  taskbar?: ReactNode;
  footer?: ReactNode;
  mobileTaskbar?: ReactNode | null;
  mobileFooter?: ReactNode | null;
  className?: string;
  style?: CSSProperties;
  showBorder?: boolean;
  showBorderOnMobile?: boolean;
}

export function ResponsiveMainLane({
  children,
  taskbar,
  footer,
  mobileTaskbar = null,
  mobileFooter = null,
  className,
  style,
  showBorder = true,
  showBorderOnMobile = false,
}: ResponsiveMainLaneProps) {
  const { isMobileLayout } = useAuraCapabilities();
  const showBorderLeft = showBorder && (!isMobileLayout || showBorderOnMobile);

  return (
    <Lane
      flex
      className={className}
      style={{
        ...style,
        ...(showBorderLeft ? { borderLeft: "1px solid var(--color-border)" } : {}),
      }}
      taskbar={isMobileLayout ? mobileTaskbar : taskbar}
      footer={isMobileLayout ? mobileFooter : footer}
    >
      <main className={styles.mainContent}>
        {children}
      </main>
    </Lane>
  );
}
