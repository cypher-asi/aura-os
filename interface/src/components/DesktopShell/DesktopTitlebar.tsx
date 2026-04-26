import { Topbar, Button } from "@cypher-asi/zui";
import { Server } from "lucide-react";
import { OrgSelector } from "../OrgSelector";
import { WindowControls } from "../WindowControls";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { windowCommand } from "../../lib/windowCommand";
import styles from "./DesktopShell.module.css";

interface DesktopTitlebarProps {
  sidekickCollapsed: boolean;
  onToggleSidekick: () => void;
  onOpenHostSettings: () => void;
}

export function DesktopTitlebar({
  sidekickCollapsed,
  onToggleSidekick,
  onOpenHostSettings,
}: DesktopTitlebarProps) {
  const { features } = useAuraCapabilities();

  return (
    <Topbar
      className={`titlebar-drag ${styles.topbarAlignRail} ${styles.topbarBlur}`}
      onDoubleClick={() => windowCommand("maximize")}
      icon={<OrgSelector variant="icon" />}
      title={
        <span className={`titlebar-center ${styles.titleCenter}`}>
          <img
            src="/AURA_logo_text_mark.png"
            alt="AURA"
            draggable={false}
            className={styles.titleLogo}
          />
        </span>
      }
      actions={
        <div
          className={styles.titleActions}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {features.hostRetargeting && (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<Server size={16} />}
              aria-label="Open host settings"
              onClick={onOpenHostSettings}
            />
          )}
          <WindowControls
            sidekickCollapsed={sidekickCollapsed}
            onToggleSidekick={onToggleSidekick}
          />
        </div>
      }
    />
  );
}
