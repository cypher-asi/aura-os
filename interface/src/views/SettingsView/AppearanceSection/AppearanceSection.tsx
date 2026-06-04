import {
  Button,
  Panel,
  Text,
  Toggle,
  useTheme,
  THEMES,
  ACCENT_COLORS,
  type Theme,
  type AccentColor,
} from "@cypher-asi/zui";
import { Sun, Moon, MonitorSmartphone } from "lucide-react";
import { CustomTokensPanel } from "./CustomTokensPanel";
import { PresetsPanel } from "./PresetsPanel";
import { usePanelGlass } from "../../../hooks/use-panel-glass";
import type { PanelKey } from "../../../lib/panel-glass";
import styles from "./AppearanceSection.module.css";

const GLASS_PANELS: { key: PanelKey; label: string }[] = [
  { key: "left", label: "Glass left panel" },
  { key: "middle", label: "Glass main panel" },
  { key: "sidekick", label: "Glass sidekick" },
];

const THEME_LABELS: Record<Theme, string> = {
  dark: "Dark",
  light: "Light",
  system: "System",
};

const THEME_ICONS: Record<Theme, typeof Sun> = {
  dark: Moon,
  light: Sun,
  system: MonitorSmartphone,
};

const ACCENT_LABELS: Record<AccentColor, string> = {
  cyan: "Cyan",
  blue: "Blue",
  purple: "Purple",
  green: "Green",
  orange: "Orange",
  rose: "Rose",
};

const SWATCH_CLASSES: Record<AccentColor, string> = {
  cyan: styles.swatchCyan,
  blue: styles.swatchBlue,
  purple: styles.swatchPurple,
  green: styles.swatchGreen,
  orange: styles.swatchOrange,
  rose: styles.swatchRose,
};

export function AppearanceSection() {
  const { theme, accent, setTheme, setAccent } = useTheme();
  const { glass, setPanel } = usePanelGlass();

  return (
    <Panel
      variant="solid"
      border="solid"
      borderRadius="md"
      className={styles.appearancePanel}
      data-testid="settings-appearance-panel"
    >
      <Text weight="semibold" size="sm">
        Theme
      </Text>

      <div className={styles.section}>
        <Text variant="muted" size="sm">
          Mode
        </Text>
        <div className={styles.themeButtons}>
          {THEMES.map((mode) => {
            const Icon = THEME_ICONS[mode];
            return (
              <Button
                key={mode}
                size="sm"
                variant={theme === mode ? "filled" : "ghost"}
                icon={<Icon size={14} />}
                fullWidth
                onClick={() => setTheme(mode)}
              >
                {THEME_LABELS[mode]}
              </Button>
            );
          })}
        </div>
      </div>

      <div className={styles.section}>
        <Text variant="muted" size="sm">
          Accent color
        </Text>
        <div className={styles.accentSwatches}>
          {ACCENT_COLORS.map((color) => {
            const isSelected = accent === color;
            const swatchClass = `${styles.swatch} ${SWATCH_CLASSES[color]}${isSelected ? ` ${styles.swatchSelected}` : ""}`;
            return (
              <button
                key={color}
                type="button"
                className={swatchClass}
                onClick={() => setAccent(color)}
                aria-label={ACCENT_LABELS[color]}
                aria-pressed={isSelected}
                title={ACCENT_LABELS[color]}
              />
            );
          })}
        </div>
      </div>

      <div className={styles.section}>
        <Text variant="muted" size="sm">
          Effects
        </Text>
        {GLASS_PANELS.map(({ key, label }) => (
          <Toggle
            key={key}
            label={label}
            checked={glass[key]}
            onChange={(e) => setPanel(key, e.target.checked)}
          />
        ))}
        <Text variant="muted" size="xs">
          Frosts each panel so the wallpaper shows through behind it.
        </Text>
      </div>

      <div className={styles.advancedThemeTools}>
        <CustomTokensPanel />

        <Text variant="muted" size="xs">
          Custom colors persist per dark/light mode in this browser.
        </Text>

        <PresetsPanel />
      </div>

      <Text variant="muted" size="xs" className={styles.mobileThemeNote}>
        Advanced color tools are available on desktop.
      </Text>
    </Panel>
  );
}
