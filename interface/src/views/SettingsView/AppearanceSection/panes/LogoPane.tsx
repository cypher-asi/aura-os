import { type ChangeEvent, useState, useId } from "react";
import { Panel, Text, useTheme } from "@cypher-asi/zui";
import {
  useDesktopLogoColor,
  type PulseMode,
} from "../../../../hooks/use-desktop-logo-color";
import appearanceStyles from "../AppearanceSection.module.css";
import styles from "./LogoPane.module.css";

function isValidHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

// Compact duration label: seconds under a minute, m/s above.
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/**
 * Aura logo pane: color + pulse preferences for the desktop titlebar
 * wordmark. The preview mirrors `AuraWordmark` one-for-one — same mask,
 * same `aura-logo-*` keyframes (injected by `logo-pulse-keyframes.ts`),
 * same color resolution — so what you tune here is exactly what the
 * titlebar renders. Preferences are local-only (localStorage), matching
 * the theme-overrides framework.
 */
export function LogoPane() {
  const { resolvedTheme } = useTheme();
  const {
    color: logoColor, setColor: setLogoColor,
    pulseEnabled, setPulseEnabled,
    pulseMode, setPulseMode,
    pulseSpeed, setPulseSpeed,
    pulseFromColor, setPulseFromColor,
    sweepReversed, setSweepReversed,
    pauseDuration, setPauseDuration,
  } = useDesktopLogoColor();
  const defaultLogoHex = resolvedTheme === "light" ? "#000000" : "#ffffff";
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [fromHexDraft, setFromHexDraft] = useState<string | null>(null);
  const pulseCheckboxId = useId();
  const sweepReverseId = useId();

  const handleLogoColorPicker = (e: ChangeEvent<HTMLInputElement>) => {
    setLogoColor(e.target.value.toLowerCase());
    setHexDraft(null);
  };

  const handleLogoHexChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setHexDraft(raw);
    const trimmed = raw.trim();
    if (trimmed === "") {
      setLogoColor(undefined);
    } else if (isValidHex(trimmed)) {
      setLogoColor(trimmed.toLowerCase());
    }
  };

  const handleLogoHexBlur = () => setHexDraft(null);

  const handleLogoReset = () => {
    setLogoColor(undefined);
    setHexDraft(null);
  };

  const handleFromColorPicker = (e: ChangeEvent<HTMLInputElement>) => {
    setPulseFromColor(e.target.value.toLowerCase());
    setFromHexDraft(null);
  };

  const handleFromHexChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setFromHexDraft(raw);
    const trimmed = raw.trim();
    if (trimmed === "") {
      setPulseFromColor(undefined);
    } else if (isValidHex(trimmed)) {
      setPulseFromColor(trimmed.toLowerCase());
    }
  };

  const handleFromHexBlur = () => setFromHexDraft(null);

  const handleFromReset = () => {
    setPulseFromColor(undefined);
    setFromHexDraft(null);
  };

  const effectiveFromColor = pulseFromColor || defaultLogoHex;
  const effectiveToColor = logoColor || defaultLogoHex;

  return (
    <Panel
      variant="solid"
      border="solid"
      borderRadius="md"
      className={appearanceStyles.appearancePanel}
      data-testid="settings-logo-panel"
    >
      <Text weight="semibold" size="sm">
        Aura Logo
      </Text>
      <Text variant="muted" size="xs">
        Customize the wordmark color in the desktop title bar.
      </Text>

      <div className={appearanceStyles.section}>
        {/* Logo color */}
        <div className={styles.logoColorRow}>
          <input
            type="color"
            value={logoColor || defaultLogoHex}
            onChange={handleLogoColorPicker}
            className={styles.logoColorInput}
            aria-label="Pick logo color"
          />
          <input
            type="text"
            value={hexDraft ?? logoColor}
            onChange={handleLogoHexChange}
            onBlur={handleLogoHexBlur}
            placeholder={defaultLogoHex}
            className={styles.logoHexInput}
            aria-label="Logo color hex value"
            spellCheck={false}
          />
          <button
            type="button"
            className={styles.logoResetButton}
            onClick={handleLogoReset}
            disabled={!logoColor}
          >
            Reset
          </button>
        </div>

        {/* Pulse toggle */}
        <div className={styles.pulseToggleRow}>
          <input
            type="checkbox"
            id={pulseCheckboxId}
            checked={pulseEnabled}
            onChange={(e) => setPulseEnabled(e.target.checked)}
            className={styles.pulseCheckbox}
          />
          <label htmlFor={pulseCheckboxId} className={styles.pulseLabel}>
            Pulse
          </label>
        </div>

        {/* Pulse settings — revealed when enabled */}
        {pulseEnabled && (
          <div className={styles.pulseSettings}>
            {/* Mode */}
            <Text variant="muted" size="xs">Mode</Text>
            <div className={styles.pulseModeRow}>
              {(["fade", "sweep"] as PulseMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`${styles.pulseModeButton}${pulseMode === m ? ` ${styles.pulseModeButtonActive}` : ""}`}
                  onClick={() => setPulseMode(m)}
                >
                  {m === "fade" ? "Fade" : "Sweep"}
                </button>
              ))}
            </div>

            {/* Sweep direction — only shown in sweep mode */}
            {pulseMode === "sweep" && (
              <div className={styles.pulseToggleRow}>
                <input
                  type="checkbox"
                  id={sweepReverseId}
                  checked={sweepReversed}
                  onChange={(e) => setSweepReversed(e.target.checked)}
                  className={styles.pulseCheckbox}
                />
                <label htmlFor={sweepReverseId} className={styles.pulseLabel}>
                  Reverse direction
                </label>
              </div>
            )}

            {/* Speed */}
            <Text variant="muted" size="xs">Speed</Text>
            <div className={styles.pulseSpeedRow}>
              <Text variant="muted" size="xs">Fast</Text>
              <input
                type="range"
                min="0.5"
                max="30"
                step="0.1"
                value={pulseSpeed}
                onChange={(e) => setPulseSpeed(parseFloat(e.target.value))}
                className={styles.pulseSpeedSlider}
                aria-label="Pulse speed"
              />
              <Text variant="muted" size="xs">Slow</Text>
              <Text variant="muted" size="xs" className={styles.pulseSpeedValue}>
                {pulseSpeed.toFixed(1)}s
              </Text>
            </div>

            {/* Pause */}
            <Text variant="muted" size="xs">Pause</Text>
            <div className={styles.pulseSpeedRow}>
              <Text variant="muted" size="xs">0s</Text>
              <input
                type="range"
                min="0"
                max="600"
                step="0.5"
                value={pauseDuration}
                onChange={(e) => setPauseDuration(parseFloat(e.target.value))}
                className={styles.pulseSpeedSlider}
                aria-label="Pause duration"
              />
              <Text variant="muted" size="xs">10m</Text>
              <Text variant="muted" size="xs" className={styles.pulseSpeedValue}>
                {formatDuration(pauseDuration)}
              </Text>
            </div>

            {/* Pulse-from color */}
            <Text variant="muted" size="xs">Pulse from</Text>
            <div className={styles.logoColorRow}>
              <input
                type="color"
                value={pulseFromColor || defaultLogoHex}
                onChange={handleFromColorPicker}
                className={styles.logoColorInput}
                aria-label="Pick pulse-from color"
              />
              <input
                type="text"
                value={fromHexDraft ?? pulseFromColor}
                onChange={handleFromHexChange}
                onBlur={handleFromHexBlur}
                placeholder={defaultLogoHex}
                className={styles.logoHexInput}
                aria-label="Pulse-from color hex value"
                spellCheck={false}
              />
              <button
                type="button"
                className={styles.logoResetButton}
                onClick={handleFromReset}
                disabled={!pulseFromColor}
              >
                Reset
              </button>
            </div>
          </div>
        )}

        {/* Preview */}
        <div className={styles.logoPreview}>
          {!pulseEnabled ? (
            <div
              className={styles.logoPreviewMark}
              role="img"
              aria-label="AURA logo preview"
              style={{ backgroundColor: effectiveToColor }}
            />
          ) : pulseMode === "fade" ? (
            <div
              className={styles.logoPreviewMark}
              role="img"
              aria-label="AURA logo preview"
              style={{
                "--logo-pulse-from": effectiveFromColor,
                "--logo-pulse-to": effectiveToColor,
                animation: `aura-logo-fade ${pulseSpeed + pauseDuration}s ease-in-out infinite`,
              } as React.CSSProperties}
            />
          ) : (
            // Sweep: one masked element backed by a `from | to | from`
            // band gradient (300% width) slid one direction so the "to"
            // band travels across and loops seamlessly. Single mask = no
            // hairline bleed between layers. Mirrors AuraWordmark exactly.
            <div
              className={styles.logoPreviewMark}
              role="img"
              aria-label="AURA logo preview"
              style={{
                backgroundImage: `linear-gradient(90deg, ${effectiveFromColor} 0 33.333%, ${effectiveToColor} 33.333% 66.667%, ${effectiveFromColor} 66.667% 100%)`,
                backgroundSize: "300% 100%",
                backgroundRepeat: "no-repeat",
                animation: `${sweepReversed ? "aura-logo-sweep-rev" : "aura-logo-sweep"} ${pulseSpeed + pauseDuration}s ease-in-out infinite`,
              } as React.CSSProperties}
            />
          )}
        </div>
      </div>
    </Panel>
  );
}
