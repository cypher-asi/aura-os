import { type ChangeEvent } from "react";
import { Input, Text } from "@cypher-asi/zui";
import styles from "./AppearanceTab.module.css";

/**
 * Curated swatch palette shown above the freeform hex input. Each
 * swatch is one click instead of dragging through the native colour
 * picker — most users will pick a project colour from a small set,
 * and the swatches double as visual anchors in dark and light
 * themes. Tuned to feel "vivid but not neon" on both themes.
 *
 * Exported so callers can pass an alternate palette if a specific
 * field benefits from different defaults (e.g. text colors might want
 * darker / higher-contrast options) — but the default works for any
 * project-customization field, so most callers leave it alone.
 */
export const DEFAULT_SWATCHES = [
  "#7c3aed", // violet
  "#2563eb", // blue
  "#0891b2", // cyan
  "#059669", // emerald
  "#65a30d", // lime
  "#ca8a04", // amber
  "#ea580c", // orange
  "#dc2626", // red
  "#db2777", // pink
  "#94a3b8", // slate
];

interface ColorPickerProps {
  /** Section label shown above the swatch row. */
  label: string;
  /** Aria-label / tooltip stem, e.g. `"accent"` → `"Use accent #..."`,
   *  `"Clear accent"`, `"Pick custom accent color"`. Defaults to the
   *  lowercased `label`. */
  noun?: string;
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  /** Optional swatch palette override; falls back to `DEFAULT_SWATCHES`. */
  swatches?: readonly string[];
  /** Hex used as the seed for the native color picker when `value` is
   *  unset. Defaults to the first swatch. */
  fallbackHex?: string;
}

/** True if `value` parses as a six-digit hex (with leading `#`). */
function isValidHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

/**
 * Reusable color picker: curated swatch grid + native color picker +
 * validated hex text input. Used for both the accent color and the
 * project-name color in the appearance tab, parameterised by `label`
 * + `noun` so the a11y strings read correctly for each field.
 */
export function ColorPicker({
  label,
  noun,
  value,
  onChange,
  swatches = DEFAULT_SWATCHES,
  fallbackHex,
}: ColorPickerProps) {
  const current = value ?? "";
  const lowerNoun = noun ?? label.toLowerCase();
  const seed = fallbackHex ?? swatches[0] ?? "#7c3aed";

  const handleHexInput = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.trim();
    if (raw === "") {
      onChange(undefined);
      return;
    }
    // Only commit on valid hex so we don't push half-typed values
    // through to the live preview / server. Invalid intermediate
    // states still display in the input — we let the user finish
    // typing.
    if (isValidHex(raw)) {
      onChange(raw.toLowerCase());
    }
  };

  const handleNativePicker = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value.toLowerCase());
  };

  return (
    <div className={styles.controlGroup}>
      <Text variant="muted" size="sm" className={styles.sectionLabel}>
        {label}
      </Text>
      <div className={styles.swatchRow}>
        {swatches.map((hex) => (
          <button
            key={hex}
            type="button"
            className={`${styles.swatch} ${current.toLowerCase() === hex ? styles.swatchActive : ""}`}
            style={{ background: hex }}
            onClick={() => onChange(hex)}
            title={hex}
            aria-label={`Use ${lowerNoun} ${hex}`}
          />
        ))}
        <button
          type="button"
          className={`${styles.swatch} ${styles.swatchClear}`}
          onClick={() => onChange(undefined)}
          title={`Clear ${lowerNoun}`}
          aria-label={`Clear ${lowerNoun}`}
        >
          ✕
        </button>
      </div>
      <div className={styles.hexRow}>
        <input
          type="color"
          value={current || seed}
          onChange={handleNativePicker}
          className={styles.nativeColorInput}
          aria-label={`Pick custom ${lowerNoun} color`}
        />
        <Input
          value={current}
          onChange={handleHexInput}
          placeholder={seed}
        />
      </div>
    </div>
  );
}
