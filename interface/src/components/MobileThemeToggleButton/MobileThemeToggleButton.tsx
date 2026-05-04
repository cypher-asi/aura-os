import { useTheme } from "@cypher-asi/zui";
import { Moon, Sun } from "lucide-react";
import {
  cycleTheme,
  getThemeToggleAriaLabel,
  getThemeToggleIconKind,
} from "../../lib/theme-toggle";
import styles from "./MobileThemeToggleButton.module.css";

const TOUCH_TARGET_PX = 44;

const ICON_BY_KIND = {
  sun: Sun,
  moon: Moon,
} as const;

export function MobileThemeToggleButton() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const iconKind = getThemeToggleIconKind(theme, resolvedTheme);
  const Icon = ICON_BY_KIND[iconKind];
  const ariaLabel = getThemeToggleAriaLabel(theme, resolvedTheme);

  return (
    <button
      type="button"
      className={styles.mobileThemeToggle}
      aria-label={ariaLabel}
      data-testid="mobile-theme-toggle"
      data-icon={iconKind}
      style={{
        minWidth: `${TOUCH_TARGET_PX}px`,
        minHeight: `${TOUCH_TARGET_PX}px`,
      }}
      onClick={() => setTheme(cycleTheme(theme, resolvedTheme))}
    >
      <Icon size={20} aria-hidden="true" />
    </button>
  );
}
