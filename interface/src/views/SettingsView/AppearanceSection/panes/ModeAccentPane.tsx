import { useCallback, useState } from "react";
import {
  Button,
  Panel,
  Text,
  useTheme,
  THEMES,
  ACCENT_COLORS,
  type Theme,
  type AccentColor,
} from "@cypher-asi/zui";
import { Sun, Moon, MonitorSmartphone } from "lucide-react";
import { useThemeOverrides } from "../../../../hooks/use-theme-overrides";
import { deriveAccent } from "../../../../lib/theme-overrides";
import styles from "../AppearanceSection.module.css";

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
  blue: "Plasma Blue",
  purple: "Purple",
  green: "Cyber Green",
  orange: "Extreme Orange",
  rose: "Magenta",
};

const SWATCH_CLASSES: Record<AccentColor, string> = {
  cyan: styles.swatchCyan,
  blue: styles.swatchBlue,
  purple: styles.swatchPurple,
  green: styles.swatchGreen,
  orange: styles.swatchOrange,
  rose: styles.swatchRose,
};

const ACCENT_TOKENS = [
  "--color-accent",
  "--color-accent-hover",
  "--color-accent-muted",
  "--color-accent-contrast",
] as const;

export function ModeAccentPane() {
  const { theme, accent, setTheme, setAccent } = useTheme();
  const { overrides, setToken } = useThemeOverrides();
  const [customHex, setCustomHex] = useState<string>(
    () => overrides["--color-accent"] ?? "#7c3aed",
  );

  const applyCustomAccent = useCallback(
    (hex: string) => {
      setCustomHex(hex);
      const derived = deriveAccent(hex);
      if (!derived) return;
      for (const token of ACCENT_TOKENS) {
        setToken(token, derived[token]);
      }
    },
    [setToken],
  );

  const clearCustomAccent = useCallback(() => {
    for (const token of ACCENT_TOKENS) {
      setToken(token, null);
    }
  }, [setToken]);

  const hasCustomAccent = typeof overrides["--color-accent"] === "string";

  return (
    <Panel
      variant="solid"
      border="solid"
      borderRadius="md"
      className={styles.appearancePanel}
      data-testid="settings-appearance-panel"
    >
      <Text weight="semibold" size="sm">
        Appearance
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
            const isSelected = !hasCustomAccent && accent === color;
            const swatchClass = `${styles.swatch} ${SWATCH_CLASSES[color]}${isSelected ? ` ${styles.swatchSelected}` : ""}`;
            return (
              <button
                key={color}
                type="button"
                className={swatchClass}
                onClick={() => {
                  clearCustomAccent();
                  setAccent(color);
                }}
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
          Custom accent
        </Text>
        <div className={styles.customAccent}>
          <label
            className={styles.customAccentSwatch}
            style={{ background: customHex }}
          >
            <input
              type="color"
              className={styles.customAccentColorInput}
              aria-label="Custom accent color picker"
              value={/^#[0-9a-f]{6}$/i.test(customHex) ? customHex : "#7c3aed"}
              onChange={(e) => applyCustomAccent(e.target.value)}
            />
          </label>
          <input
            type="text"
            spellCheck={false}
            autoComplete="off"
            className={styles.customAccentText}
            aria-label="Custom accent hex value"
            placeholder="#7c3aed"
            value={customHex}
            onChange={(e) => applyCustomAccent(e.target.value)}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={clearCustomAccent}
            disabled={!hasCustomAccent}
          >
            Reset
          </Button>
        </div>
        <Text variant="muted" size="xs">
          Overrides the palette above with a derived hover, muted, and contrast
          shade. Saved per dark/light mode in this browser.
        </Text>
      </div>
    </Panel>
  );
}
