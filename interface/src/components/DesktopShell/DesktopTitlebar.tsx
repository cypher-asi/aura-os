import { Topbar, Button, useTheme } from "@cypher-asi/zui";
import { Server, Sun, Moon, MonitorSmartphone } from "lucide-react";
import { OrgSelector } from "../OrgSelector";
import { WindowControls } from "../WindowControls";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { windowCommand } from "../../lib/windowCommand";
import {
  cycleTheme,
  getThemeToggleAriaLabel,
  getThemeToggleIconKind,
} from "../../lib/theme-toggle";
import styles from "./DesktopShell.module.css";

interface DesktopTitlebarProps {
  sidekickCollapsed: boolean;
  onToggleSidekick: () => void;
  onOpenHostSettings: () => void;
}

const ICON_BY_KIND = {
  sun: Sun,
  moon: Moon,
  system: MonitorSmartphone,
} as const;

function ThemeToggleButton() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const Icon = ICON_BY_KIND[getThemeToggleIconKind(theme, resolvedTheme)];

  return (
    <span className="titlebar-no-drag">
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon={<Icon size={16} />}
        aria-label={getThemeToggleAriaLabel(theme, resolvedTheme)}
        onClick={() => setTheme(cycleTheme(theme))}
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
            data-aura-wordmark
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
