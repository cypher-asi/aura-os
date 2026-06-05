import { Panel, Text } from "@cypher-asi/zui";
import { Select } from "../../../../components/Select/Select";
import { useTypography } from "../../../../hooks/use-theme-typography";
import {
  SANS_FONTS,
  MONO_FONTS,
  TYPOGRAPHY_SCALE_MIN,
  TYPOGRAPHY_SCALE_MAX,
} from "../../../../lib/theme-typography";
import styles from "../AppearanceSection.module.css";

export function TypographyPane() {
  const { typography, setSans, setMono, setScale } = useTypography();

  return (
    <Panel
      variant="solid"
      border="solid"
      borderRadius="md"
      className={styles.appearancePanel}
      data-testid="settings-typography-panel"
    >
      <Text weight="semibold" size="sm">
        Typography
      </Text>

      <div className={styles.section}>
        <Text variant="muted" size="sm">
          Interface font
        </Text>
        <Select
          value={typography.sans}
          onChange={setSans}
          options={SANS_FONTS.map((font) => ({
            value: font.id,
            label: font.label,
          }))}
        />
      </div>

      <div className={styles.section}>
        <Text variant="muted" size="sm">
          Monospace font
        </Text>
        <Select
          value={typography.mono}
          onChange={setMono}
          options={MONO_FONTS.map((font) => ({
            value: font.id,
            label: font.label,
          }))}
        />
      </div>

      <div className={styles.section}>
        <div className={styles.slider}>
          <label className={styles.sliderLabel} htmlFor="typography-scale">
            <Text size="sm">Text size</Text>
            <Text variant="muted" size="xs">
              {typography.scale}%
            </Text>
          </label>
          <input
            id="typography-scale"
            type="range"
            className={styles.sliderInput}
            min={TYPOGRAPHY_SCALE_MIN}
            max={TYPOGRAPHY_SCALE_MAX}
            step={5}
            value={typography.scale}
            aria-label="Text size"
            onChange={(e) => setScale(Number(e.target.value))}
          />
        </div>
        <Text variant="muted" size="xs">
          Scales text across the interface. Saved in this browser.
        </Text>
      </div>
    </Panel>
  );
}
