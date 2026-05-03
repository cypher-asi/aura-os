import { Topbar, Button, useTheme, type Theme } from "@cypher-asi/zui";
import { Server, Sun, Moon, MonitorSmartphone } from "lucide-react";
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

const THEME_CYCLE: Record<Theme, Theme> = {
  dark: "light",
  light: "system",
  system: "dark",
};

function ThemeToggleButton() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  const Icon = theme === "system"
    ? MonitorSmartphone
    : resolvedTheme === "light"
      ? Sun
      : Moon;
  const stateLabel = theme === "system" ? "system" : resolvedTheme;

  return (
    <span className="titlebar-no-drag">
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon={<Icon size={16} />}
        aria-label={`Switch theme (currently ${stateLabel})`}
        onClick={() => setTheme(THEME_CYCLE[theme])}
      />
    </span>
  );
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
          <ThemeToggleButton />
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
