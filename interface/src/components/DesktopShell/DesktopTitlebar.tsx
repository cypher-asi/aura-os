import { Topbar, Button, useTheme } from "@cypher-asi/zui";
import { Server, Sun, Moon } from "lucide-react";
import { OrgSelector } from "../OrgSelector";
import { WindowControls } from "../WindowControls";
import { MenuBar } from "../MenuBar";
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
} as const;

function ThemeToggleButton() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const Icon = ICON_BY_KIND[getThemeToggleIconKind(theme, resolvedTheme)];

  return (
    <span className="titlebar-no-drag">
      <Button
        variant="ghost"
        size="sm"
        rounded="md"
        iconOnly
        aria-label={getThemeToggleAriaLabel(theme, resolvedTheme)}
        onClick={() => setTheme(cycleTheme(theme, resolvedTheme))}
      >
        <Icon size={14} strokeWidth={2} />
      </Button>
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
      icon={
        <span className={`${styles.titleLeading} titlebar-no-drag`}>
          <OrgSelector variant="icon" />
          <MenuBar />
        </span>
      }
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
              rounded="md"
              iconOnly
              aria-label="Open host settings"
              onClick={onOpenHostSettings}
            >
              <Server size={14} strokeWidth={2} />
            </Button>
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
